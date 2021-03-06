// Copyright (c) 2014,2015 Walter Bender
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.
//
// You should have received a copy of the GNU General Public License
// along with this library; if not, write to the Free Software
// Foundation, 51 Franklin Street, Suite 500 Boston, MA 02110-1335 USA
// All things related to blocks

var blockBlocks = null;

// Minimum distance (squared) between to docks required before
// connecting them.
var MINIMUMDOCKDISTANCE = 400;

// Special value flags to uniquely identify these media blocks.
var CAMERAVALUE = '##__CAMERA__##';
var VIDEOVALUE = '##__VIDEO__##';

// Blocks holds the list of blocks and most of the block-associated
// methods, since most block manipulations are inter-block.

function Blocks(canvas, stage, refreshCanvas, trashcan, updateStage) {
    // Things we need from outside include access to the canvas, the
    // stage, and the trashcan.
    this.canvas = canvas;
    this.stage = stage;
    this.refreshCanvas = refreshCanvas;
    this.trashcan = trashcan;
    this.updateStage = updateStage;

    // We keep a dictionary for the proto blocks,
    this.protoBlockDict = {}
    // and a list of the blocks we create.
    this.blockList = [];

    // Track the time with mouse down.
    this.time = 0;
    this.timeOut = null;

    // "Copy stack" selects a stack for pasting. Are we selecting?
    this.selectingStack = false;
    // and what did we select?
    this.selectedStack = null;

    // If we somehow have a malformed block database (for example,
    // from importing a corrupted datafile, we need to avoid infinite
    // loops while crawling the block list.
    this.loopCounter = 0;
    this.sizeCounter = 0;
    this.searchCounter = 0;

    // We need a reference to the palettes.
    this.palettes = null;
    // Which block, if any, is highlighted?
    this.highlightedBlock = null;
    // Which block, if any, is active?
    this.activeBlock = null;
    // Are the blocks visible?
    this.visible = true;
    // The group of blocks being dragged or moved together
    this.dragGroup = [];
    // The blocks at the tops of stacks
    this.stackList = [];
    // The blocks that need expanding
    this.expandablesList = [];
    // Number of blocks to load
    this.loadCounter = 0;
    // Stacks of blocks that need adjusting as blocks are repositioned
    // due to expanding and contracting or insertion into the flow.
    this.adjustTheseDocks = [];
    // Blocks that need collapsing after load.
    this.blocksToCollapse = [];

    // We need to keep track of certain classes of blocks that exhibit
    // different types of behavior.

    // Blocks with parts that expand, e.g.,
    this.expandableBlocks = [];
    // Blocks that contain child flows of blocks
    this.clampBlocks = [];
    this.doubleExpandable = [];
    // Blocks that are used as arguments to other blocks
    this.argBlocks = [];
    // Blocks that return values
    this.valueBlocks = [];
    // Two-arg blocks with two arguments (expandable).
    this.twoArgBlocks = [];
    // Blocks that don't run when clicked.
    this.noRunBlocks = ['action'];

    // We need to know if we are processing a copy or save stack command.
    this.inLongPress = false;

    // We need access to the msg block...
    this.setMsgText = function(msgText) {
        this.msgText = msgText;
    }

    // and the Error msg function.
    this.setErrorMsg = function(errorMsg) {
        this.errorMsg = errorMsg;
    }

    // We need access to the macro dictionary because we add to it.
    this.setMacroDictionary = function(obj) {
        this.macroDict = obj;
    }

    // We need access to the turtles list because we associate a
    // turtle with each start block.
    this.setTurtles = function(turtles) {
        this.turtles = turtles;
    }

    // We need to access the "pseudo-Logo interpreter" when we click
    // on blocks.
    this.setLogo = function(logo) {
        this.logo = logo;
    }

    // The scale of the graphics is determined by screen size.
    this.setScale = function(scale) {
        this.scale = scale;
    }

    // Toggle state of collapsible blocks.
    this.toggleCollapsibles = function() {
        for (var blk in this.blockList) {
            var myBlock = this.blockList[blk];
            if (['start', 'action'].indexOf(myBlock.name) != -1) {
                myBlock.collapseToggle();
            }
        }
    }

    // set up copy/paste, dismiss, and copy-stack buttons
    this.makeCopyPasteButtons = function(makeButton, updatePasteButton) {
        var blocks = this;
        this.updatePasteButton = updatePasteButton;

        this.copyButton = makeButton('copy-button', 0, 0, 55);
        this.copyButton.visible = false;

        this.dismissButton = makeButton('cancel-button', 0, 0, 55);
        this.dismissButton.visible = false;

        this.saveStackButton = makeButton('save-blocks-button', 0, 0, 55);
        this.saveStackButton.visible = false;

        this.copyButton.on('click', function(event) {
            var topBlock = blocks.findTopBlock(blocks.activeBlock);
            blocks.selectedStack = topBlock;
            blocks.copyButton.visible = false;
            blocks.saveStackButton.visible = false;
            blocks.dismissButton.visible = false;
            blocks.inLongPress = false;
            blocks.updatePasteButton();
            blocks.refreshCanvas();
        });

        this.dismissButton.on('click', function(event) {
            blocks.copyButton.visible = false;
            blocks.saveStackButton.visible = false;
            blocks.dismissButton.visible = false;
            blocks.inLongPress = false;
            blocks.refreshCanvas();
        });

        this.saveStackButton.on('click', function(event) {
            // Only invoked from action blocks.
            var topBlock = blocks.findTopBlock(blocks.activeBlock);
            blocks.inLongPress = false;
            blocks.selectedStack = topBlock;
            blocks.copyButton.visible = false;
            blocks.saveStackButton.visible = false;
            blocks.dismissButton.visible = false;
            blocks.saveStack();
            blocks.refreshCanvas();
        });
    }

    // Walk through all of the proto blocks in order to make lists of
    // any blocks that need special treatment.
    this.findBlockTypes = function() {
        for (var proto in this.protoBlockDict) {
            if (this.protoBlockDict[proto].expandable) {
                this.expandableBlocks.push(this.protoBlockDict[proto].name);
            }
            if (this.protoBlockDict[proto].style == 'clamp') {
                this.clampBlocks.push(this.protoBlockDict[proto].name);
            }
            if (this.protoBlockDict[proto].style == 'twoarg') {
                this.twoArgBlocks.push(this.protoBlockDict[proto].name);
            }
            if (this.protoBlockDict[proto].style == 'arg') {
                this.argBlocks.push(this.protoBlockDict[proto].name);
            }
            if (this.protoBlockDict[proto].style == 'value') {
                this.argBlocks.push(this.protoBlockDict[proto].name);
                this.valueBlocks.push(this.protoBlockDict[proto].name);
            }
            if (this.protoBlockDict[proto].style == 'doubleclamp') {
                this.doubleExpandable.push(this.protoBlockDict[proto].name);
            }

        }
    }

    // Adjust the docking postions of all blocks in the current drag
    // group.
    this.adjustBlockPositions = function() {
        if (this.dragGroup.length < 2) {
            return;
        }

        // Just in case the block list is corrupted, count iterations.
        this.loopCounter = 0;
        this.adjustDocks(this.dragGroup[0])
    }

    // Adjust the size of the clamp in an expandable block when blocks
    // are inserted into (or removed from) the child flow. This is a
    // common operation for start and action blocks, but also for
    // repeat, forever, if, etc.
    this.adjustExpandableClampBlock = function(blocksToCheck) {
        if (blocksToCheck.length == 0) {
            // Should not happen
            return;
        }
        var blk = blocksToCheck.pop();

        var myBlock = this.blockList[blk];
        // Make sure it is the proper type of expandable block.
        if (myBlock.isArgBlock() || myBlock.isTwoArgBlock()) {
            return;
        }

        function clampAdjuster(me, blk, myBlock, clamp, blocksToCheck) {
            // First we need to count up the number of (and size of) the
            // blocks inside the clamp; The child flow is usually the
            // second-to-last argument.
            if (clamp == 0) {
                var c = myBlock.connections.length - 2;
            } else { // e.g., Bottom clamp in if-then-else
                var c = myBlock.connections.length - 3;
            }
            me.sizeCounter = 0;
            var childFlowSize = 1;
            if (c > 0 && myBlock.connections[c] != null) {
                childFlowSize = Math.max(me.getStackSize(myBlock.connections[c]), 1);
            }

            // Adjust the clamp size to match the size of the child
            // flow.
            var plusMinus = childFlowSize - myBlock.clampCount[clamp];
            if (plusMinus != 0) {
                if (!(childFlowSize == 0 && myBlock.clampCount[clamp] == 1)) {
                    myBlock.updateSlots(clamp, plusMinus, blocksToCheck);
                }
            }

            // Recurse through the list.
            if (blocksToCheck.length > 0) {
                me.adjustExpandableClampBlock(blocksToCheck);
            }
        }

        if (myBlock.isDoubleClampBlock()) {
            clampAdjuster(this, blk, myBlock, 1, blocksToCheck);
        }
        clampAdjuster(this, blk, myBlock, 0, blocksToCheck);
    }

    // Returns the block size.
    this.getBlockSize = function(blk) {
        var myBlock = this.blockList[blk];
        return myBlock.size;
        // FIXME? No need to recurse since cascaded value is stored in
        // myBlock.size. But is it robust? Maybe we should recurse
        // and not store the cascaded size?
        /* 
        var size = myBlock.size;
        if ((myBlock.isArgBlock() || myBlock.isTwoArgBlock()) && this.blockList[i].isExpandableBlock() && myBlock.connections[1] != null) {
            return size + this.getBlockSize(myBlock.connections[1]) - 1;
        } else {
            return size;
        }
        */
    }

    // We also adjust the size of twoarg blocks. It is similar to how
    // we adjust clamps, but enough different that it is in its own
    // function.
    this.adjustExpandableTwoArgBlock = function(blocksToCheck) {
        if (blocksToCheck.length == 0) {
            // Should not happen
            return;
        }
        var blk = blocksToCheck.pop();
        var myBlock = this.blockList[blk];
        // Determine the size of the first argument.
        var c = myBlock.connections[1];
        var firstArgumentSize = 1; // Minimum size
        if (c != null) {
            firstArgumentSize = Math.max(this.getBlockSize(c), 1);
        }
        var plusMinus = firstArgumentSize - myBlock.clampCount[0];
        if (plusMinus != 0) {
            if (!(firstArgumentSize == 0 && myBlock.clampCount[0] == 1)) {
                myBlock.updateSlots(0, plusMinus, blocksToCheck);
            }
        }
    }

    this.addRemoveVspaceBlock = function(blk) {
        var myBlock = blockBlocks.blockList[blk];

        var c = myBlock.connections[myBlock.connections.length - 2];
        var secondArgumentSize = 1;
        if (c != null) {
            var secondArgumentSize = Math.max(this.getBlockSize(c), 1);
        }

        var vSpaceCount = howManyVSpaceBlocksBelow(blk);
        if (secondArgumentSize < vSpaceCount + 1) {
            // Remove a vspace block
            var n = Math.abs(secondArgumentSize - vSpaceCount - 1);
            for (var i = 0; i < n; i++) {
                var lastConnection = myBlock.connections.length - 1;
                var vspaceBlock = this.blockList[myBlock.connections[lastConnection]];
                var nextBlockIndex = vspaceBlock.connections[1];
                myBlock.connections[lastConnection] = nextBlockIndex;
                if (nextBlockIndex != null) {
                    this.blockList[nextBlockIndex].connections[0] = blk;
                }
                vspaceBlock.connections = [null, null];
                vspaceBlock.trash = true;
                vspaceBlock.hide();
            }
        } else if (secondArgumentSize > vSpaceCount + 1) {
            // Add a vspace block
            var n = secondArgumentSize - vSpaceCount - 1;
            for (var nextBlock, newPos, i = 0; i < n; i++) {
                nextBlock = last(myBlock.connections);
                newPos = blockBlocks.blockList.length;

                blockBlocks.makeNewBlockWithConnections('vspace', newPos, [null, null], function(args) {
                    var vspace = args[1];
                    var nextBlock = args[0];
                    var vspaceBlock = blockBlocks.blockList[vspace];
                    vspaceBlock.connections[0] = blk;
                    vspaceBlock.connections[1] = nextBlock;
                    myBlock.connections[myBlock.connections.length - 1] = vspace;
                    if (nextBlock) {
                        blockBlocks.blockList[nextBlock].connections[0] = vspace;
                    }
                }, [nextBlock, newPos]);
            }
        }

        function howManyVSpaceBlocksBelow(blk) {
            // Need to know how many vspace blocks are below the block
            // we're checking against.
            var nextBlock = last(blockBlocks.blockList[blk].connections);
            if (nextBlock && blockBlocks.blockList[nextBlock].name == 'vspace') {
                return 1 + howManyVSpaceBlocksBelow(nextBlock);
                // Recurse until it isn't a vspace
            }
            return 0;
        }
    }

    this.getStackSize = function(blk) {
        // How many block units in this stack?
        var size = 0;
        this.sizeCounter += 1;
        if (this.sizeCounter > this.blockList.length * 2) {
            console.log('Infinite loop encountered detecting size of expandable block? ' + blk);
            return size;
        }

        if (blk == null) {
            return size;
        }

        var myBlock = this.blockList[blk];
        if (myBlock == null) {
            console.log('Something very broken in getStackSize.');
        }

        if (myBlock.isClampBlock()) {
            var c = myBlock.connections.length - 2;
            var csize = 0;
            if (c > 0) {
                var cblk = myBlock.connections[c];
                if (cblk != null) {
                    csize = this.getStackSize(cblk);
                }
                if (csize == 0) {
                    size = 1; // minimum of 1 slot in clamp
                } else {
                    size = csize;
                }
            }
            if (myBlock.isDoubleClampBlock()) {
                var c = myBlock.connections.length - 3;
                var csize = 0;
                if (c > 0) {
                    var cblk = myBlock.connections[c];
                    if (cblk != null) {
                        var csize = this.getStackSize(cblk);
                    }
                    if (csize == 0) {
                        size += 1; // minimum of 1 slot in clamp
                    } else {
                        size += csize;
                    }
                }
            }
            // add top and bottom of clamp
            size += myBlock.size;
        } else {
            size = myBlock.size;
        }

        // check on any connected block
        if (!myBlock.isValueBlock()) {
            var cblk = last(myBlock.connections);
            if (cblk != null) {
                size += this.getStackSize(cblk);
            }
        }
        return size;
    }

    this.adjustDocks = function(blk, resetLoopCounter) {
        // Give a block, adjust the dock positions
        // of all of the blocks connected to it

        var myBlock = this.blockList[blk];

        // For when we come in from makeBlock
        if (resetLoopCounter != null) {
            this.loopCounter = 0;
        }

        // These checks are to test for malformed data. All blocks
        // should have connections.
        if (myBlock == null) {
            console.log('Saw a null block: ' + blk);
            return;
        }
        if (myBlock.connections == null) {
            console.log('Saw a block with null connections: ' + blk);
            return;
        }
        if (myBlock.connections.length == 0) {
            console.log('Saw a block with [] connections: ' + blk);
            return;
        }

        // Value blocks only have one dock.
        if (myBlock.docks.length == 1) {
            return;
        }

        this.loopCounter += 1;
        if (this.loopCounter > this.blockList.length * 2) {
            console.log('Infinite loop encountered while adjusting docks: ' + blk + ' ' + this.blockList);
            return;
        }

        // Walk through each connection except the parent block; the
        // exception being the parent block of boolean 2arg blocks,
        // since the dock[0] position can change.
        if (myBlock.isTwoArgBooleanBlock()) {
            var start = 0;
        } else {
            var start = 1;
        }
        for (var c = start; c < myBlock.connections.length; c++) {
            // Get the dock position for this connection.
            var bdock = myBlock.docks[c];

            // Find the connecting block.
            var cblk = myBlock.connections[c];
            // Nothing connected here so continue to the next connection.
            if (cblk == null) {
                continue;
            }

            // Another database integrety check.
            if (this.blockList[cblk] == null) {
                console.log('This is not good: we encountered a null block: ' + cblk);
                continue;
            }

            // Find the dock position in the connected block.
            var foundMatch = false;
            for (var b = 0; b < this.blockList[cblk].connections.length; b++) {
                if (this.blockList[cblk].connections[b] == blk) {
                    foundMatch = true;
                    break
                }
            }

            // Yet another database integrety check.
            if (!foundMatch) {
                console.log('Did not find match for ' + myBlock.name + ' and ' + this.blockList[cblk].name);
                break;
            }

            var cdock = this.blockList[cblk].docks[b];

            if (c > 0) {
                // Move the connected block...
                var dx = bdock[0] - cdock[0];
                var dy = bdock[1] - cdock[1];
                if (myBlock.container == null) {
                    console.log('Does this ever happen any more?')
                    var nx = myBlock.x + dx;
                    var ny = myBlock.y + dy;
                } else {
                    var nx = myBlock.container.x + dx;
                    var ny = myBlock.container.y + dy;
                }
                this.moveBlock(cblk, nx, ny);
            } else {
                // or it's parent.
                var dx = cdock[0] - bdock[0];
                var dy = cdock[1] - bdock[1];
                var nx = this.blockList[cblk].container.x + dx;
                var ny = this.blockList[cblk].container.y + dy;
                this.moveBlock(blk, nx, ny);
            }

            if (c > 0) {
                // Recurse on connected blocks.
                this.adjustDocks(cblk);
            }
        }
    }

    this.blockMoved = function(thisBlock) {
        // When a block is moved, we have lots of things to check:
        // (0) Is it inside of a expandable block?
        // (1) Is it an arg block connected to a two-arg block?
        // (2) Disconnect its connection[0];
        // (3) Look for a new connection;
        // (4) Is it an arg block connected to a 2-arg block?
        // (5) Recheck if it inside of a expandable block.

        // Find any containing expandable blocks.
        var checkExpandableBlocks = [];
        if (thisBlock == null) {
            console.log('block moved called with null block.');
            return;
        }
        var blk = this.insideExpandableBlock(thisBlock);
        var expandableLoopCounter = 0;
        while (blk != null) {
            expandableLoopCounter += 1;
            if (expandableLoopCounter > 2 * this.blockList.length) {
                console.log('Inifinite loop encountered checking for expandables?');
                break;
            }
            checkExpandableBlocks.push(blk);
            blk = this.insideExpandableBlock(blk);
        }

        var checkTwoArgBlocks = [];
        var checkArgBlocks = [];
        var myBlock = this.blockList[thisBlock];
        if (myBlock == null) {
            console.log('null block found in blockMoved method: ' + thisBlock);
            return;
        }
        var c = myBlock.connections[0];
        if (c != null) {
            var cBlock = this.blockList[c];
        }
        // If it is an arg block, where is it coming from?
        if (myBlock.isArgBlock() && c != null) {
            // We care about twoarg (2arg) blocks with
            // connections to the first arg;
            if (this.blockList[c].isTwoArgBlock()) {
                if (cBlock.connections[1] == thisBlock) {
                    checkTwoArgBlocks.push(c);
                }
            } else if (this.blockList[c].isArgBlock() && this.blockList[c].isExpandableBlock()) {
                if (cBlock.connections[1] == thisBlock) {
                    checkTwoArgBlocks.push(c);
                }
            }
        }

        // Disconnect from connection[0] (both sides of the connection).
        if (c != null) {
            // disconnect both ends of the connection
            for (var i = 1; i < cBlock.connections.length; i++) {
                if (cBlock.connections[i] == thisBlock) {
                    cBlock.connections[i] = null;
                    break;
                }
            }
            myBlock.connections[0] = null;
        }

        // Look for a new connection.
        var x1 = myBlock.container.x + myBlock.docks[0][0];
        var y1 = myBlock.container.y + myBlock.docks[0][1];
        // Find the nearest dock; if it is close
        // enough, connect;
        var newBlock = null;
        var newConnection = null;
        // TODO: Make minimum distance relative to scale.
        var min = MINIMUMDOCKDISTANCE;
        var blkType = myBlock.docks[0][2]
        for (var b = 0; b < this.blockList.length; b++) {
            // Don't connect to yourself.
            if (b == thisBlock) {
                continue;
            }
            for (var i = 1; i < this.blockList[b].connections.length; i++) {
                // When converting from Python projects to JS format,
                // sometimes extra null connections are added. We need
                // to ignore them.
                if (i == this.blockList[b].docks.length) {
                    break;
                }

                // Look for available connections.
                if (this.testConnectionType(
                    blkType,
                    this.blockList[b].docks[i][2])) {
                    x2 = this.blockList[b].container.x + this.blockList[b].docks[i][0];
                    y2 = this.blockList[b].container.y + this.blockList[b].docks[i][1];
                    dist = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
                    if (dist < min) {
                        newBlock = b;
                        newConnection = i;
                        min = dist;
                    }
                } else {
                    // TODO: bounce away from illegal connection?
                    // only if the distance was small
                    // console.log('cannot not connect these two block types');
                }
            }
        }

        if (newBlock != null) {
            // We found a match.
            myBlock.connections[0] = newBlock;
            var connection = this.blockList[newBlock].connections[newConnection];
            if (connection != null) {
                if (myBlock.isArgBlock()) {
                    this.blockList[connection].connections[0] = null;
                    this.findDragGroup(connection);                    
                    for (var c = 0; c < this.dragGroup.length; c++) {
                        this.moveBlockRelative(this.dragGroup[c], 40, 40);
                    }
                } else {
                    var bottom = this.findBottomBlock(thisBlock);
                    this.blockList[connection].connections[0] = bottom;
                    this.blockList[bottom].connections[this.blockList[bottom].connections.length - 1] = connection;
                }
            }
            this.blockList[newBlock].connections[newConnection] = thisBlock;
            this.loopCounter = 0;
            this.adjustDocks(newBlock);
            // TODO: some graphical feedback re new connection?
        }

        // If it is an arg block, where is it coming from?
        if (myBlock.isArgBlock() && newBlock != null) {
            // We care about twoarg blocks with connections to the
            // first arg;
            if (this.blockList[newBlock].isTwoArgBlock()) {
                if (this.blockList[newBlock].connections[1] == thisBlock) {
                    if (checkTwoArgBlocks.indexOf(newBlock) == -1) {
                        checkTwoArgBlocks.push(newBlock);
                    }
                }
            } else if (this.blockList[newBlock].isArgBlock() && this.blockList[newBlock].isExpandableBlock()) {
                if (this.blockList[newBlock].connections[1] == thisBlock) {
                    if (checkTwoArgBlocks.indexOf(newBlock) == -1) {
                        checkTwoArgBlocks.push(newBlock);
                    }
                }
            }
            // We also care about the second-to-last connection to an arg block.
            var n = this.blockList[newBlock].connections.length;
            if (this.blockList[newBlock].connections[n - 2] == thisBlock) {
                // Only flow blocks.
                if (this.blockList[newBlock].docks[n - 1][2] == 'in') {
                    checkArgBlocks.push(newBlock);
                }
            }
        }

        // Put block adjustments inside a slight delay to make the
        // addition/substraction of vspace and changes of block shape
        // appear less abrupt (and it can be a little racy).
        var blocks = this;
        setTimeout(function () {
            // If we changed the contents of a arg block, we may need a vspace.
            if (checkArgBlocks.length > 0) {
                for (var i = 0; i < checkArgBlocks.length; i++) {
                    blocks.addRemoveVspaceBlock(checkArgBlocks[i]);
                }
            }

            // If we changed the contents of a two-arg block, we need to
            // adjust it.
            if (checkTwoArgBlocks.length > 0) {
                blocks.adjustExpandableTwoArgBlock(checkTwoArgBlocks);
            }

            // First, adjust the docks for any blocks that may have
            // had a vspace added.
            for (var i = 0; i < checkArgBlocks.length; i++) {
                blocks.adjustDocks(checkArgBlocks[i]);
            }

            // Next, recheck if the connection is inside of a
            // expandable block.
            var blk = blocks.insideExpandableBlock(thisBlock);
            var expandableLoopCounter = 0;
            while (blk != null) {
                // Extra check for malformed data.
                expandableLoopCounter += 1;
                if (expandableLoopCounter > 2 * blocks.blockList.length) {
                    console.log('Infinite loop checking for expandables?');
                    console.log(blocks.blockList);
                    break;
                }
                if (checkExpandableBlocks.indexOf(blk) == -1) {
                    checkExpandableBlocks.push(blk);
                }
                blk = blocks.insideExpandableBlock(blk);
            }
            blocks.adjustExpandableClampBlock(checkExpandableBlocks);
            blocks.refreshCanvas();
        }, 250);
    }

    this.testConnectionType = function(type1, type2) {
        // Can these two blocks dock?
        if (type1 == 'in' && type2 == 'out') {
            return true;
        }
        if (type1 == 'out' && type2 == 'in') {
            return true;
        }
        if (type1 == 'numberin' && ['numberout', 'anyout'].indexOf(type2) != -1) {
            return true;
        }
        if (['numberout', 'anyout'].indexOf(type1) != -1 && type2 == 'numberin') {
            return true;
        }
        if (type1 == 'textin' && ['textout', 'anyout'].indexOf(type2) != -1) {
            return true;
        }
        if (['textout', 'anyout'].indexOf(type1) != -1 && type2 == 'textin') {
            return true;
        }
        if (type1 == 'booleanout' && type2 == 'booleanin') {
            return true;
        }
        if (type1 == 'booleanin' && type2 == 'booleanout') {
            return true;
        }
        if (type1 == 'mediain' && type2 == 'mediaout') {
            return true;
        }
        if (type1 == 'mediaout' && type2 == 'mediain') {
            return true;
        }
        if (type1 == 'mediain' && type2 == 'textout') {
            return true;
        }
        if (type2 == 'mediain' && type1 == 'textout') {
            return true;
        }
        if (type1 == 'filein' && type2 == 'fileout') {
            return true;
        }
        if (type1 == 'fileout' && type2 == 'filein') {
            return true;
        }
        if (type1 == 'anyin' && ['textout', 'mediaout', 'numberout', 'anyout', 'fileout'].indexOf(type2) != -1) {
            return true;
        }
        if (type2 == 'anyin' && ['textout', 'mediaout', 'numberout', 'anyout', 'fileout'].indexOf(type1) != -1) {
            return true;
        }
        return false;
    }

    this.updateBlockPositions = function() {
        // Create the block image if it doesn't yet exist.
        for (var blk = 0; blk < this.blockList.length; blk++) {
            this.moveBlock(blk, this.blockList[blk].x, this.blockList[blk].y);
        }
    }

    this.bringToTop = function() {
        // Move all the blocks to the top layer of the stage
        for (var blk in this.blockList) {
            var myBlock = this.blockList[blk];
            this.stage.removeChild(myBlock.container);
            this.stage.addChild(myBlock.container);
            if (myBlock.collapseContainer != null) {
                this.stage.removeChild(myBlock.collapseContainer);
                this.stage.addChild(myBlock.collapseContainer);
            }
        }
        this.refreshCanvas();
    }

    this.moveBlock = function(blk, x, y) {
        // Move a block (and its label) to x, y.
        var myBlock = this.blockList[blk];
        if (myBlock.container != null) {
            myBlock.container.x = x;
            myBlock.container.y = y;
            myBlock.x = x
            myBlock.y = y
            if (myBlock.collapseContainer != null) {
                myBlock.collapseContainer.x = x + COLLAPSEBUTTONXOFF;
                myBlock.collapseContainer.y = y + COLLAPSEBUTTONYOFF;
            }
        } else {
            console.log('no container yet');
            myBlock.x = x
            myBlock.y = y
        }
    }

    this.moveBlockRelative = function(blk, dx, dy) {
        // Move a block (and its label) by dx, dy.
        var myBlock = this.blockList[blk];
        if (myBlock.container != null) {
            myBlock.container.x += dx;
            myBlock.container.y += dy;
            myBlock.x = myBlock.container.x;
            myBlock.y = myBlock.container.y;
            if (myBlock.collapseContainer != null) {
                myBlock.collapseContainer.x += dx;
                myBlock.collapseContainer.y += dy;
            }
        } else {
            console.log('no container yet');
            myBlock.x += dx
            myBlock.y += dy
        }
    }

    this.updateBlockText = function(blk) {
        // When we create new blocks, we may not have assigned the
        // value yet.
        var myBlock = this.blockList[blk];
        var maxLength = 8;
        if (myBlock.text == null) {
            return;
        }
        if (myBlock.name == 'loadFile') {
            try {
                var label = myBlock.value[0].toString();
            } catch (e) {
                var label = _('open file');
            }
            maxLength = 10;
        } else {
            var label = myBlock.value.toString();
        }
        if (label.length > maxLength) {
            label = label.substr(0, maxLength - 1) + '...';
        }
        myBlock.text.text = label;

        // Make sure text is on top.
        z = myBlock.container.getNumChildren() - 1;
        myBlock.container.setChildIndex(myBlock.text, z);

        if (myBlock.loadComplete) {
            myBlock.container.updateCache();
        } else {
            console.log('load not yet complete for ' + blk);
        }
    }

    this.findTopBlock = function(blk) {
        // Find the top block in a stack.
        if (blk == null) {
            return null;
        }

        var myBlock = this.blockList[blk];
        if (myBlock.connections == null) {
            return blk;
        }

        if (myBlock.connections.length == 0) {
            return blk;
        }

        var topBlockLoop = 0;
        while (myBlock.connections[0] != null) {
            topBlockLoop += 1;
            if (topBlockLoop > 2 * this.blockList.length) {
                // Could happen if the block data is malformed.
                console.log('infinite loop finding topBlock?');
                console.log(myBlock.name);
                break;
            }
            blk = myBlock.connections[0];
            myBlock = this.blockList[blk];
        }
        return blk;
    }

    this.findBottomBlock = function(blk) {
        // Find the bottom block in a stack.
        if (blk == null) {
            return null;
        }

        var myBlock = this.blockList[blk];
        if (myBlock.connections == null) {
            return blk;
        }
        if (myBlock.connections.length == 0) {
            return blk;
        }

        var bottomBlockLoop = 0;
        while (last(myBlock.connections) != null) {
            bottomBlockLoop += 1;
            if (bottomBlockLoop > 2 * this.blockList.length) {
                // Could happen if the block data is malformed.
                console.log('infinite loop finding bottomBlock?');
                break;
            }
            blk = last(myBlock.connections);
            myBlock = this.blockList[blk];
        }
        return blk;
    }

    this.findStacks = function() {
        // Find any blocks with null in the first connection.
        this.stackList = [];
        for (i = 0; i < this.blockList.length; i++) {
            if (this.blockList[i].connections[0] == null) {
                this.stackList.push(i)
            }
        }
    }

    this.findClamps = function() {
        // Find any clamp blocks.
        this.expandablesList = [];
        this.findStacks(); // We start by finding the stacks
        for (var i = 0; i < this.stackList.length; i++) {
            this.searchCounter = 0;
            this.searchForExpandables(this.stackList[i]);
        }
    }

    this.findTwoArgs = function() {
        // Find any expandable arg blocks.
        this.expandablesList = [];
        for (var i = 0; i < this.blockList.length; i++) {
            if (this.blockList[i].isArgBlock() && this.blockList[i].isExpandableBlock()) {
                this.expandablesList.push(i);
            } else if (this.blockList[i].isTwoArgBlock()) {
                this.expandablesList.push(i);
            }
        }
    }

    this.searchForExpandables = function(blk) {
        // Find the expandable blocks below blk in a stack.
        while (blk != null && this.blockList[blk] != null && !this.blockList[blk].isValueBlock()) {
            // More checks for malformed or corrupted block data.
            this.searchCounter += 1;
            if (this.searchCounter > 2 * this.blockList.length) {
                console.log('infinite loop searching for Expandables? ' + this.searchCounter);
                console.log(blk + ' ' + this.blockList[blk].name);
                break;
            }
            if (this.blockList[blk].isClampBlock()) {
                this.expandablesList.push(blk);
                var c = this.blockList[blk].connections.length - 2;
                this.searchForExpandables(this.blockList[blk].connections[c]);
            }
            blk = last(this.blockList[blk].connections);
        }
    }

    this.expandTwoArgs = function() {
        // Expand expandable 2-arg blocks as needed.
        this.findTwoArgs();
        this.adjustExpandableTwoArgBlock(this.expandablesList);
        this.refreshCanvas();
    }

    this.expandClamps = function() {
        // Expand expandable clamp blocks as needed.
        this.findClamps();
        this.adjustExpandableClampBlock(this.expandablesList);
        this.refreshCanvas();
    }

    this.unhighlightAll = function() {
        for (var blk in this.blockList) {
            this.unhighlight(blk);
        }
    }

    this.unhighlight = function(blk) {
        if (!this.visible) {
            return;
        }
        if (blk != null) {
            var thisBlock = blk;
        } else {
            var thisBlock = this.highlightedBlock;
        }
        if (thisBlock != null) {
            this.blockList[thisBlock].unhighlight();
        }
        if (this.highlightedBlock = thisBlock) {
            this.highlightedBlock = null;
        }
    }

    this.highlight = function(blk, unhighlight) {
        if (!this.visible) {
            return;
        }
        if (blk != null) {
            if (unhighlight) {
                this.unhighlight(null);
            }
            this.blockList[blk].highlight();
            this.highlightedBlock = blk;
        }
    }

    this.hide = function() {
        for (var blk in this.blockList) {
            this.blockList[blk].hide();
        }
        this.visible = false;
    }

    this.show = function() {
        for (var blk in this.blockList) {
            this.blockList[blk].show();
        }
        this.visible = true;
    }

    this.makeNewBlockWithConnections = function(name, blockOffset, connections, postProcess, postProcessArg, collapsed) {
        if (typeof(collapsed) === 'undefined') {
            collapsed = false
        }
        myBlock = this.makeNewBlock(name, postProcess, postProcessArg);
        if (myBlock == null) {
            console.log('could not make block ' + name);
            return;
        }

        // myBlock.collapsed = !collapsed;
        for (var c = 0; c < connections.length; c++) {
            if (c == myBlock.docks.length) {
                break;
            }
            if (connections[c] == null) {
                myBlock.connections.push(null);
            } else {
                myBlock.connections.push(connections[c] + blockOffset);
            }
        }
    }

    this.makeNewBlock = function(name, postProcess, postProcessArg) {
        // Create a new block
        if (!name in this.protoBlockDict) {
            // Should never happen: nop blocks should be substituted
            console.log('makeNewBlock: no prototype for ' + name);
            return null;
        }
        if (this.protoBlockDict[name] == null) {
            // Should never happen
            console.log('makeNewBlock: no prototype for ' + name);
            return null;
        }
        if (name == 'namedbox' || name == 'nameddo') {
            this.blockList.push(new Block(this.protoBlockDict[name], this, postProcessArg[1]));
        } else {
            this.blockList.push(new Block(this.protoBlockDict[name], this));
        }
        if (last(this.blockList) == null) {
            // Should never happen
            console.log('failed to make protoblock for ' + name);
            return null;
        }

        // We copy the dock because expandable blocks modify it.
        var myBlock = last(this.blockList);
        myBlock.copySize();

        // We may need to do some postProcessing to the block
        myBlock.postProcess = postProcess;
        myBlock.postProcessArg = postProcessArg;

        // We need a container for the block graphics.
        myBlock.container = new createjs.Container();
        this.stage.addChild(myBlock.container);
        myBlock.container.snapToPixelEnabled = true;
        myBlock.container.x = myBlock.x;
        myBlock.container.y = myBlock.y;

        // and we need to load the images into the container.
        myBlock.imageLoad();
        return myBlock;
    }

    this.makeBlock = function(name, arg) {
        // Make a new block from a proto block.
        // Called from palettes.

        console.log('makeBlock ' + name + ' ' + arg);
        var postProcess = null;
        var postProcessArg = null;
        var me = this;
        var thisBlock = this.blockList.length;
        if (name == 'start') {
            postProcess = function(thisBlock) {
                me.blockList[thisBlock].value = me.turtles.turtleList.length;
                me.turtles.add(me.blockList[thisBlock]);
            }
            postProcessArg = thisBlock;
        } else if (name == 'text') {
            postProcess = function(args) {
                var thisBlock = args[0];
                var value = args[1];
                me.blockList[thisBlock].value = value;
                me.blockList[thisBlock].text.text = value;
                me.blockList[thisBlock].container.updateCache();
            }
            postProcessArg = [thisBlock, _('text')];
        } else if (name == 'number') {
            postProcess = function(args) {
                var thisBlock = args[0];
                var value = Number(args[1]);
                me.blockList[thisBlock].value = value;
                me.blockList[thisBlock].text.text = value.toString();
                me.blockList[thisBlock].container.updateCache();
            }
            postProcessArg = [thisBlock, 100];
        } else if (name == 'media') {
            postProcess = function(args) {
                var thisBlock = args[0];
                var value = args[1];
                me.blockList[thisBlock].value = value;
                if (value == null) {
                    me.blockList[thisBlock].image = 'images/load-media.svg';
                } else {
                    me.blockList[thisBlock].image = null;
                }
            }
            postProcessArg = [thisBlock, null];
        } else if (name == 'camera') {
            postProcess = function(args) {
                console.log('post process camera ' + args[1]);
                var thisBlock = args[0];
                var value = args[1];
                me.blockList[thisBlock].value = CAMERAVALUE;
                if (value == null) {
                    me.blockList[thisBlock].image = 'images/camera.svg';
                } else {
                    me.blockList[thisBlock].image = null;
                }
            }
            postProcessArg = [thisBlock, null];
        } else if (name == 'video') {
            postProcess = function(args) {
                var thisBlock = args[0];
                var value = args[1];
                me.blockList[thisBlock].value = VIDEOVALUE;
                if (value == null) {
                    me.blockList[thisBlock].image = 'images/video.svg';
                } else {
                    me.blockList[thisBlock].image = null;
                }
            }
            postProcessArg = [thisBlock, null];
        } else if (name == 'loadFile') {
            postProcess = function(args) {
                me.updateBlockText(args[0]);
            }
            postProcessArg = [thisBlock, null];
        } else if (name == 'namedbox' || name == 'nameddo') {
            postProcess = function(args) {
                me.blockList[thisBlock].value = null;
                me.blockList[thisBlock].privateData = args[1];
            }
            postProcessArg = [thisBlock, arg];
        }

        var protoFound = false;
        for (var proto in me.protoBlockDict) {
            if (me.protoBlockDict[proto].name == name) {
                if (arg == '__NOARG__') {
                    console.log('creating ' + name + ' block with no args');
                    me.makeNewBlock(proto, postProcess, postProcessArg);
                    protoFound = true;
                    break;
                } else if (me.protoBlockDict[proto].defaults[0] == arg) {
                    console.log('creating ' + name + ' block with default arg ' + arg);
                    me.makeNewBlock(proto, postProcess, postProcessArg);
                    protoFound = true;
                    break;
                } else if (name == 'namedbox' || name == 'nameddo') {
                    if (me.protoBlockDict[proto].defaults[0] == undefined) {
                        me.makeNewBlock(proto, postProcess, postProcessArg);
                        protoFound = true;
                        break;
                    }
                }
            }
        }
        if (!protoFound) {
            console.log(name + ' not found!!');
        }

        var blk = this.blockList.length - 1;
        var myBlock = this.blockList[blk];
        for (var i = 0; i < myBlock.docks.length; i++) {
            myBlock.connections.push(null);
        }

        // Attach default args if any
        var cblk = blk + 1;
        for (var i = 0; i < myBlock.protoblock.defaults.length; i++) {
            var value = myBlock.protoblock.defaults[i];

            if (myBlock.name == 'action') {
                // Make sure we don't make two actions with the same name.
                console.log('calling findUniqueActionName');
                value = this.findUniqueActionName(_('action'));
                console.log('renaming action block to ' + value);
                if (value != _('action')) {
                    console.log('calling newNameddoBlock with value ' + value);
                    // this.newDoBlock(value);
                    this.newNameddoBlock(value);
                    this.palettes.updatePalettes();
                }
            }

            var me = this;
            var thisBlock = this.blockList.length;
            if (myBlock.docks[i + 1][2] == 'anyin') {
                if (value == null) {
                    console.log('cannot set default value');
                } else if (typeof(value) == 'string') {
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = value;
                        var label = value.toString();
                        if (label.length > 8) {
                            label = label.substr(0, 7) + '...';
                        }
                        me.blockList[thisBlock].text.text = label;
                        me.blockList[thisBlock].container.updateCache();
                    }
                    this.makeNewBlock('text', postProcess, [thisBlock, value]);
                } else {
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = Number(args[1]);
                        me.blockList[thisBlock].value = value;
                        me.blockList[thisBlock].text.text = value.toString();
                    }
                    this.makeNewBlock('number', postProcess, [thisBlock, value]);
                }
            } else if (myBlock.docks[i + 1][2] == 'textin') {
                postProcess = function(args) {
                    var thisBlock = args[0];
                    var value = args[1];
                    me.blockList[thisBlock].value = value;
                    var label = value.toString();
                    if (label.length > 8) {
                        label = label.substr(0, 7) + '...';
                    }
                    me.blockList[thisBlock].text.text = label;
                }
                this.makeNewBlock('text', postProcess, [thisBlock, value]);
            } else if (myBlock.docks[i + 1][2] == 'mediain') {
                postProcess = function(args) {
                    var thisBlock = args[0];
                    var value = args[1];
                    me.blockList[thisBlock].value = value;
                    if (value != null) {
                        // loadThumbnail(me, thisBlock, null);
                    }
                }
                this.makeNewBlock('media', postProcess, [thisBlock, value]);
            } else if (myBlock.docks[i + 1][2] == 'filein') {
                postProcess = function(blk) {
                    me.updateBlockText(blk);
                }
                this.makeNewBlock('loadFile', postProcess, thisBlock);
            } else {
                postProcess = function(args) {
                    var thisBlock = args[0];
                    var value = args[1];
                    me.blockList[thisBlock].value = value;
                    me.blockList[thisBlock].text.text = value.toString();
                }
                this.makeNewBlock('number', postProcess, [thisBlock, value]);
            }

            var myConnectionBlock = this.blockList[cblk + i];
            myConnectionBlock.connections = [blk];
            myConnectionBlock.value = value;
            myBlock.connections[i + 1] = cblk + i;
        }

        // Generate and position the block bitmaps and labels
        this.updateBlockPositions();
        this.adjustDocks(blk, true);
        this.refreshCanvas();

        return blk;
    }

    this.findDragGroup = function(blk) {
        // Generate a drag group from blocks connected to blk
        this.dragGroup = [];
        this.calculateDragGroup(blk);
    }

    this.calculateDragGroup = function(blk) {
        // Give a block, find all the blocks connected to it
        if (blk == null) {
            return;
        }

        var myBlock = this.blockList[blk];
        // If this happens, something is really broken.
        if (myBlock == null) {
            console.log('null block encountered... this is bad. ' + blk);
            return;
        }

        // As before, does these ever happen?
        if (myBlock.connections == null) {
            return;
        }

        if (myBlock.connections.length == 0) {
            return;
        }

        this.dragGroup.push(blk);

        for (var c = 1; c < myBlock.connections.length; c++) {
            var cblk = myBlock.connections[c];
            if (cblk != null) {
                // Recurse
                this.calculateDragGroup(cblk);
            }
        }
    }

    this.findUniqueActionName = function(name) {
        // Make sure we don't make two actions with the same name.
        var actionNames = [];
        for (var blk = 0; blk < this.blockList.length; blk++) {
            if (this.blockList[blk].name == 'text') {
                var c = this.blockList[blk].connections[0];
                if (c != null && this.blockList[c].name == 'action') {
                    actionNames.push(this.blockList[blk].value);
                }
            }
        }

        if (actionNames.length == 1) {
            return name;
        }

        var i = 1;
        var value = name;
        while (actionNames.indexOf(value) != -1) {
            value = name + i.toString();
            i += 1;
        }
        return value;
    }

    this.renameBoxes = function(oldName, newName) {
        if (oldName == newName) {
            // Nothing to do.
            return;
        }
        for (var blk = 0; blk < this.blockList.length; blk++) {
            if (this.blockList[blk].name == 'text') {
                var c = this.blockList[blk].connections[0];
                if (c != null && this.blockList[c].name == 'box') {
                    if (this.blockList[blk].value == oldName) {
                        this.blockList[blk].value = newName;
                        this.blockList[blk].text.text = newName;
                        try {
                            this.blockList[blk].container.updateCache();
                        } catch (e) {
                            console.log(e);
                        }
                    }
                }
            }
        }
    }

    this.renameNamedboxes = function(oldName, newName) {
        if (oldName == newName) {
            // console.log('Nothing to do.');
            return;
        }

        for (var blk = 0; blk < this.blockList.length; blk++) {
            if (this.blockList[blk].name == 'namedbox') {
                if (this.blockList[blk].privateData == oldName) {
                    this.blockList[blk].privateData = newName;
                    this.blockList[blk].overrideName = newName;
                    this.blockList[blk].regenerateArtwork();
                    // Update label...
                    try {
                        this.blockList[blk].container.updateCache();
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
        }

        // Update the palette
        var blockPalette = this.palettes.dict['blocks'];
        var nameChanged = false;
        for (var blockId = 0; blockId < blockPalette.protoList.length; blockId++) {
            var block = blockPalette.protoList[blockId];
            if (block.name == 'namedbox') {
                console.log(block);
            }
            if (block.name == 'namedbox' && block.defaults[0] != _('box') && block.defaults[0] == oldName) {
                console.log('renaming ' + block.defaults[0] + ' to ' + newName);
                block.defaults[0] = newName;
                nameChanged = true;
            }
        }
        // Force an update if the name has changed.
        if (nameChanged) {
            regeneratePalette(blockPalette);
        }
    }

    this.renameDos = function(oldName, newName) {
        if (oldName == newName) {
            console.log('Nothing to do.');
            return;
        }
        // Update the blocks, do->oldName should be do->newName
        for (var blk = 0; blk < this.blockList.length; blk++) {
            var myBlock = this.blockList[blk];
            var blkParent = this.blockList[myBlock.connections[0]];
            if (blkParent == null) {
                continue;
            }
            if (['do', 'action'].indexOf(blkParent.name) == -1) {
                continue;
            }
            var blockValue = myBlock.value;
            if (blockValue == oldName) {
                myBlock.value = newName;
                var label = myBlock.value;
                if (label.length > 8) {
                    label = label.substr(0, 7) + '...';
                }
                myBlock.text.text = label;
                myBlock.container.updateCache();
            }
        }
    }

    this.renameNameddos = function(oldName, newName) {
        if (oldName == newName) {
            console.log('Nothing to do.');
            return;
        }

        // Update the blocks, do->oldName should be do->newName
        for (var blk = 0; blk < this.blockList.length; blk++) {
            if (this.blockList[blk].name == 'nameddo') {
                if (this.blockList[blk].privateData == oldName) {
                    this.blockList[blk].privateData = newName;
                    var label = newName;
                    if (label.length > 8) {
                        label = label.substr(0, 7) + '...';
                    }
                    this.blockList[blk].overrideName = label;
                    console.log('regenerating artwork for ' + label);
                    this.blockList[blk].regenerateArtwork();
                }
            }
        }

        // Update the palette
        var blockPalette = this.palettes.dict['actions'];
        var nameChanged = false;
        for (var blockId = 0; blockId < blockPalette.protoList.length; blockId++) {
            var block = blockPalette.protoList[blockId];
            if (block.name == 'nameddo') {
                console.log(block);
            }
            if (block.name == 'nameddo' && block.defaults[0] != _('action') && block.defaults[0] == oldName) {
                console.log('renaming ' + block.defaults[0] + ' to ' + newName);
                block.defaults[0] = newName;
                nameChanged = true;
            }
        }
        // Force an update if the name has changed.
        if (nameChanged) {
            regeneratePalette(blockPalette);
        }
    }

    this.newStoreinBlock = function(name) {
        console.log('new storein block ' + name);
        if ('myStorein_' + name in this.protoBlockDict) {
            // console.log('Nothing to do.');
            return;
        }
        var myStoreinBlock = new ProtoBlock('storein');
        this.protoBlockDict['myStorein_' + name] = myStoreinBlock;
        myStoreinBlock.palette = this.palettes.dict['blocks'];
        myStoreinBlock.defaults.push(name);
        myStoreinBlock.defaults.push(100);
        myStoreinBlock.staticLabels.push(_('store in'), _('name'), _('value'));
        myStoreinBlock.adjustWidthToLabel();
        myStoreinBlock.twoArgBlock();
        myStoreinBlock.dockTypes[1] = 'anyin';
        myStoreinBlock.dockTypes[2] = 'anyin';
        if (name == 'box') {
            return;
        }
        myStoreinBlock.palette.add(myStoreinBlock);
    }

    this.newNamedboxBlock = function(name) {
        if ('myBox_' + name in this.protoBlockDict) {
            // console.log('Nothing to do.');
            return;
        }
        var myBoxBlock = new ProtoBlock('namedbox');
        this.protoBlockDict['myBox_' + name] = myBoxBlock;
        myBoxBlock.parameterBlock();
        myBoxBlock.palette = this.palettes.dict['blocks'];
        myBoxBlock.defaults.push(name);
        myBoxBlock.staticLabels.push(name);
        if (name == 'box') {
            return;
        }
        myBoxBlock.palette.add(myBoxBlock);
    }

    this.newNameddoBlock = function(name) {
        if ('myDo_' + name in this.protoBlockDict) {
            // console.log('Nothing to do.');
            return;
        }
        var myDoBlock = new ProtoBlock('nameddo');
        this.protoBlockDict['myDo_' + name] = myDoBlock;
        myDoBlock.zeroArgBlock();
        myDoBlock.palette = this.palettes.dict['actions'];
        myDoBlock.defaults.push(name);
        myDoBlock.staticLabels.push(name);
        if (name == 'action') {
            return;
        }
        myDoBlock.palette.add(myDoBlock);
    }

    this.newActionBlock = function(name) {
        if ('myAction_' + name in this.protoBlockDict) {
            // console.log('Nothing to do.');
            return;
        }
        var myActionBlock = new ProtoBlock('action');
        this.protoBlockDict['myAction_' + name] = myActionBlock;
        myActionBlock.stackClampOneArgBlock();
        myActionBlock.palette = this.palettes.dict['actions'];
        myActionBlock.defaults.push(name);
        myActionBlock.staticLabels.push(_('action'));
        myActionBlock.expandable = true;
        myActionBlock.style = 'clamp';
        if (name == 'action') {
            return;
        }
        myActionBlock.palette.add(myActionBlock);
    }

    this.insideExpandableBlock = function(blk) {
        // Returns a containing expandable block or null
        if (this.blockList[blk] == null) {
            // race condition?
            console.log('null block in blockList? ' + blk);
            return null;
        } else if (this.blockList[blk].connections[0] == null) {
            return null;
        } else {
            var cblk = this.blockList[blk].connections[0];
            if (this.blockList[cblk].isExpandableBlock()) {
                // If it is the last connection, keep searching.
                if (blk == last(this.blockList[cblk].connections)) {
                    return this.insideExpandableBlock(cblk);
                } else {
                    return cblk;
                }
            } else {
                return this.insideExpandableBlock(cblk);
            }
        }
    }

    this.triggerLongPress = function(myBlock) {
        this.timeOut == null;
        this.inLongPress = true;
        this.copyButton.visible = true;
        this.copyButton.x = myBlock.container.x - 27;
        this.copyButton.y = myBlock.container.y - 27;
        this.dismissButton.visible = true;
        this.dismissButton.x = myBlock.container.x + 27;
        this.dismissButton.y = myBlock.container.y - 27;
        if (myBlock.name == 'action') {
            this.saveStackButton.visible = true;
            this.saveStackButton.x = myBlock.container.x + 82;
            this.saveStackButton.y = myBlock.container.y - 27;
        }
        this.refreshCanvas();
    }

    this.pasteStack = function() {
        // Copy a stack of blocks by creating a blockObjs and passing
        // it to this.load.
        if (this.selectedStack == null) {
            return;
        }
        var blockObjs = this.copyBlocksToObj();
        this.loadNewBlocks(blockObjs);
    }

    this.saveStack = function() {
        // Save a stack of blocks to local storage and the my-stack
        // palette by creating a blockObjs and ...
        if (this.selectedStack == null) {
            return;
        }
        var blockObjs = this.copyBlocksToObj();
        // The first block is an action block. Its first connection is
        // the block containing its label.
        var nameBlk = blockObjs[0][4][1];
        if (nameBlk == null) {
            console.log('action not named... skipping');
        } else {
            console.log(blockObjs[nameBlk][1][1]);
            if (typeof(blockObjs[nameBlk][1][1]) == 'string') {
                var name = blockObjs[nameBlk][1][1];
            } else if (typeof(blockObjs[nameBlk][1][1]) == 'number') {
                var name = blockObjs[nameBlk][1][1].toString();
            } else {
                var name = blockObjs[nameBlk][1][1]['value'];
            }
            localStorage.setItem('macros', prepareMacroExports(name, blockObjs, this.macroDict));
            this.addToMyPalette(name, blockObjs);
            this.palettes.updatePalettes();
        }
    }

    this.copyBlocksToObj = function() {
        var blockObjs = [];
        var blockMap = {};

        this.findDragGroup(this.selectedStack);
        for (var b = 0; b < this.dragGroup.length; b++) {
            myBlock = this.blockList[this.dragGroup[b]];
            if (b == 0) {
                x = 25;
                y = 25;
            } else {
                x = 0;
                y = 0;
            }
            if (myBlock.isValueBlock()) {
                switch (myBlock.name) {
                    case 'media':
                        blockItem = [b, [myBlock.name, null], x, y, []];
                        break;
                    default:
                        blockItem = [b, [myBlock.name, myBlock.value], x, y, []];
                        break;
                }
            } else {
                blockItem = [b, myBlock.name, x, y, []];
            }
            blockMap[this.dragGroup[b]] = b;
            blockObjs.push(blockItem);
        }
        for (var b = 0; b < this.dragGroup.length; b++) {
            myBlock = this.blockList[this.dragGroup[b]];
            for (var c = 0; c < myBlock.connections.length; c++) {
                if (myBlock.connections[c] == null) {
                    blockObjs[b][4].push(null);
                } else {
                    blockObjs[b][4].push(blockMap[myBlock.connections[c]]);
                }
            }
        }
        return blockObjs;
    }

    this.addToMyPalette = function(name, obj) {
        // On the palette we store the macro as a basic block.
        var myBlock = new ProtoBlock('macro_' + name);
        var blkName = 'macro_' + name;
        this.protoBlockDict[blkName] = myBlock;
        if (!('myblocks' in this.palettes.dict)) {
            this.palettes.add('myblocks');
        }
        myBlock.palette = this.palettes.dict['myblocks'];
        myBlock.zeroArgBlock();
        myBlock.staticLabels.push(_(name));
        this.protoBlockDict[blkName].palette.add(this.protoBlockDict[blkName]);
    }

    this.loadNewBlocks = function(blockObjs) {
        // Check for blocks connected to themselves,
        // and for action blocks not connected to text blocks.
        for (var b = 0; b < blockObjs.length; b++) {
            var blkData = blockObjs[b];
            for (var c in blkData[4]) {
                if (blkData[4][c] == blkData[0]) {
                    console.log('Circular connection in block data: ' + blkData);
                    console.log('Punting loading of new blocks!');
                    console.log(blockObjs);
                    return;
                }
            }
        }

        // We'll need a list of existing storein and action names.
        var currentActionNames = [];
        var currentStoreinNames = [];
        for (var b = 0; b < this.blockList.length; b++) {
            if (this.blockList[b].name == 'action') {
                if (this.blockList[b].connections[1] != null) {
                    currentActionNames.push(this.blockList[this.blockList[b].connections[1]].value);
                }
            } else if (this.blockList[b].name == 'storein') {
                if (this.blockList[b].connections[1] != null) {
                    currentStoreinNames.push(this.blockList[this.blockList[b].connections[1]].value);
                }
            }
        }

        // We need to track two-arg blocks incase they need expanding. 
        var checkTwoArgBlocks = [];

        // Don't make duplicate action names.
        // Add a palette entry for any new storein blocks.
        var stringNames = [];
        var stringValues = {}; // label: [blocks with that label]
        var actionNames = {}; // action block: label block
        var storeinNames = {}; // storein block: label block
        var doNames = {}; // do block: label block, nameddo block value

        // action and start blocks that need to be collapsed.
        this.blocksToCollapse = [];

        // Scan for any new action and storein blocks to identify
        // duplicates. We also need to track start and action blocks
        // that may need to be collapsed.
        for (var b = 0; b < blockObjs.length; b++) {
            var blkData = blockObjs[b];
            // blkData[1] could be a string or an object.
            if (typeof(blkData[1]) == 'string') {
                var name = blkData[1];
            } else {
                var name = blkData[1][0];
            }

            if (['arg', 'twoarg'].indexOf(this.protoBlockDict[name].style) != -1) {
                if (this.protoBlockDict[name].expandable) {
                    checkTwoArgBlocks.push(this.blockList.length + b);
                }
            }

            switch (name) {
                case 'text':
                    var key = blkData[1][1];
                    if (stringValues[key] == undefined) {
                        stringValues[key] = [];
                    }
                    stringValues[key].push(b);
                    break;
                case 'action':
                case 'hat':
                    if (blkData[4][1] != null) {
                        actionNames[b] = blkData[4][1];
                    }
                    break;
                case 'storein':
                    if (blkData[4][1] != null) {
                        storeinNames[b] = blkData[4][1];
                    }
                    break;
                case 'nameddo': 
                    doNames[b] = blkData[1][1]['value'];
                    break;
                case 'do':
                case 'stack':
                    if (blkData[4][1] != null) {
                        doNames[b] = blkData[4][1];
                    }
                    break;
                default:
                    break;
            }

            switch (name) {
                case 'action':
                case 'start':
                    if (typeof(blkData[1]) == 'object' && blkData[1].length > 1 && typeof(blkData[1][1]) == 'object' && 'collapsed' in blkData[1][1]) {
                        if (blkData[1][1]['collapsed']) {
                            this.blocksToCollapse.push(this.blockList.length + b);
                        }
                    }
                    break;
                default:
                    break;
            }
        }

        var updatePalettes = false;
        // Make sure new storein names have palette entries.
        for (var b in storeinNames) {
            var blkData = blockObjs[storeinNames[b]];
            if (currentStoreinNames.indexOf(blkData[1][1]) == -1) {
                if (typeof(blkData[1][1]) == 'string') {
                    var name = blkData[1][1];
                } else {
                    var name = blkData[1][1]['value'];
                }
                console.log('Adding new palette entries for store-in ' + name);
		this.newStoreinBlock(name);
                this.newNamedboxBlock(name);
                updatePalettes = true;
            }
        }

        // Make sure action names are unique.
        for (var b in actionNames) {
            // Is there a proto do block with this name? If so, find a
            // new name.
            // Name = the value of the connected label.
            var blkData = blockObjs[actionNames[b]];
            if (typeof(blkData[1][1]) == 'string') {
                var name = blkData[1][1];
            } else {
                var name = blkData[1][1]['value'];
            }
            var oldName = name;
            var i = 1;
            while (currentActionNames.indexOf(name) != -1) {
                name = oldName + i.toString();
                i += 1;
                // Should never happen... but just in case.
                if (i > this.blockList.length) {
                    console.log('Could not generate unique action name.');
                    break;
                }
            }

            if (oldName != name) {
                // Change the name of the action...
                console.log('action ' + oldName + ' is being renamed ' + name);
                blkData[1][1] = {'value': name};
            }

            // add a new nameddo block to the palette...
            this.newNameddoBlock(name);
            updatePalettes = true;
            // and any do blocks
            for (var d in doNames) {
                var thisBlkData = blockObjs[d];
                if (typeof(thisBlkData[1]) == 'string') {
                    var blkName = thisBlkData[1];
                } else {
                    var blkName = thisBlkData[1][0];
                }
                if (blkName == 'nameddo') {
                    if (thisBlkData[1][1]['value'] == oldName) {
                        console.log('renaming ' + oldName + ' to ' + name);
                        thisBlkData[1][1] = {'value': name};
                    }
                } else {
                    var doBlkData = blockObjs[doNames[d]];
                    if (typeof(doBlkData[1][1]) == 'string') {
                        if (doBlkData[1][1] == oldName) {
                            console.log('renaming ' + oldName + ' to ' + name);
                            doBlkData[1][1] = name;
                        }
                    } else {
                        if (doBlkData[1][1]['value'] == oldName) {
                            console.log('renaming ' + oldName + ' to ' + name);
                            doBlkData[1][1] = {'value': name};
                        }
                    }
                }
            }
        }

        if (updatePalettes) {
            this.palettes.updatePalettes();
        }

        // Append to the current set of blocks.
        this.adjustTheseDocks = [];
        this.loadCounter = blockObjs.length;
        // We add new blocks to the end of the block list.
        var blockOffset = this.blockList.length;

        console.log(this.loadCounter + ' blocks to load');
        for (var b = 0; b < this.loadCounter; b++) {
            var thisBlock = blockOffset + b;
            var blkData = blockObjs[b];

            if (typeof(blkData[1]) == 'object') {
                if (blkData[1].length == 1) {
                    blkInfo = [blkData[1][0], {'value': null}];
                } else if (['number', 'string'].indexOf(typeof(blkData[1][1])) != -1) {
                    blkInfo = [blkData[1][0], {'value': blkData[1][1]}];
                    if (['start', 'action', 'hat'].indexOf(blkData[1][0]) != -1) {
                        blkInfo[1]['collapsed'] = false;
                    }
                } else {
                    blkInfo = blkData[1];
                }
            } else {
                blkInfo = [blkData[1], {'value': null}];
                if (['start', 'action', 'hat'].indexOf(blkData[1]) != -1) {
                    blkInfo[1]['collapsed'] = false;
                }
            }

            var name = blkInfo[0];

            var collapsed = false;
            if (['start', 'action'].indexOf(name) != -1) {
                collapsed = blkInfo[1]['collapsed'];
            }

            if (blkInfo[1] == null) {
                var value = null;
            } else {
                var value = blkInfo[1]['value'];
            }

            if (name in NAMEDICT) {
                name = NAMEDICT[name];
            }

            var me = this;
            // A few special cases.
            switch (name) {
                // Only add 'collapsed' arg to start, action blocks.
                case 'start':
                    blkData[4][0] = null;
                    blkData[4][2] = null;

                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var blkInfo = args[1];
                        me.blockList[thisBlock].value = me.turtles.turtleList.length;
                        me.turtles.add(me.blockList[thisBlock], blkInfo);
                    }
                    this.makeNewBlockWithConnections('start', blockOffset, blkData[4], postProcess, [thisBlock, blkInfo[1]], collapsed);
                    break;
                case 'action':
                case 'hat':
                    blkData[4][0] = null;
                    blkData[4][3] = null;
                    this.makeNewBlockWithConnections('action', blockOffset, blkData[4], null, null, collapsed);
                    break;

                    // Named boxes and dos need private data.
                case 'namedbox':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].privateData = value;
                        me.blockList[thisBlock].value = null;
                    }
                    this.makeNewBlockWithConnections('namedbox', blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                case 'nameddo':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].privateData = value;
                        me.blockList[thisBlock].value = null;
                    }
                    this.makeNewBlockWithConnections('nameddo', blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;

                    // Value blocks need a default value set.
                case 'number':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = Number(value);
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                case 'text':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = value;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                case 'media':
                    // Load a thumbnail into a media blocks.
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = value;
                        if (value != null) {
                            // Load artwork onto media block.
                            me.blockList[thisBlock].loadThumbnail(null);
                        }
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                case 'camera':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = CAMERAVALUE;
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                case 'video':
                    postProcess = function(args) {
                        var thisBlock = args[0];
                        var value = args[1];
                        me.blockList[thisBlock].value = VIDEOVALUE;
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;

                    // Define some constants for legacy blocks for
                    // backward compatibility with Python projects.
                case 'red':
                case 'white':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = 0;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'orange':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = 10;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'yellow':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = 20;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'green':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = 40;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'blue':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = 70;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'leftpos':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = -(canvas.width / 2);
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'rightpos':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = (canvas.width / 2);
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'toppos':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = (canvas.height / 2);
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'botpos':
                case 'bottompos':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = -(canvas.height / 2);
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'width':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = canvas.width;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'height':
                    postProcess = function(thisBlock) {
                        me.blockList[thisBlock].value = canvas.height;
                        me.updateBlockText(thisBlock);
                    }
                    this.makeNewBlockWithConnections('number', blockOffset, blkData[4], postProcess, thisBlock);
                    break;
                case 'loadFile':
                    postProcess = function(args) {
                        me.blockList[args[0]].value = args[1];
                        me.updateBlockText(args[0]);
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], postProcess, [thisBlock, value]);
                    break;
                default:
                    // Check that name is in the proto list
                    if (!name in this.protoBlockDict || this.protoBlockDict[name] == null) {
                        // Lots of assumptions here.
                        // TODO: figure out if it is a flow or an arg block.
                        // Substitute a NOP block for an unknown block.
                        n = blkData[4].length;
                        console.log(n + ': substituting nop block for ' + name);
                        switch (n) {
                            case 1:
                                name = 'nopValueBlock';
                                break;
                            case 2:
                                name = 'nopZeroArgBlock';
                                break;
                            case 3:
                                name = 'nopOneArgBlock';
                                break;
                            case 4:
                                name = 'nopTwoArgBlock';
                                break;
                            case 5:
                            default:
                                name = 'nopThreeArgBlock';
                                break;
                        }
                    }
                    this.makeNewBlockWithConnections(name, blockOffset, blkData[4], null);
                    break;
            }
            if (thisBlock == this.blockList.length - 1) {
                if (this.blockList[thisBlock].connections[0] == null) {
                    this.blockList[thisBlock].x = blkData[2];
                    this.blockList[thisBlock].y = blkData[3];
                    this.adjustTheseDocks.push(thisBlock);
                }
            }
        }
	if (checkTwoArgBlocks.length > 0) {
            // We make multiple passes because we need to account for nesting.
            for (i = 0; i < checkTwoArgBlocks.length; i++) {
                for (b = 0; b < checkTwoArgBlocks.length; b++) {
                    this.adjustExpandableTwoArgBlock([checkTwoArgBlocks[b]]);
                }
            }
	}
    }

    this.cleanupAfterLoad = function() {
        // If all the blocks are loaded, we can make the final adjustments.
        this.loadCounter -= 1;
        if (this.loadCounter > 0) {
            return;
        }

        this.updateBlockPositions();
        for (var blk = 0; blk < this.adjustTheseDocks.length; blk++) {
            this.loopCounter = 0;
            this.adjustDocks(this.adjustTheseDocks[blk]);
            blockBlocks.expandTwoArgs();
            blockBlocks.expandClamps();
        }

        for (var i = 0; i < this.blocksToCollapse.length; i++) {
            console.log('collapse ' + this.blockList[this.blocksToCollapse[i]].name);
            this.blockList[this.blocksToCollapse[i]].collapseToggle();
        }
        this.blocksToCollapse = [];

        this.refreshCanvas();
    }

    this.raiseStackToTop = function (blk) {
        // Move the stack associated with blk to the top.
        var topBlk = this.findTopBlock(blk);
        this.findDragGroup(topBlk);

        var n = this.stage.getNumChildren() - 1;
        for (var b = 0; b < this.dragGroup.length; b++) {
            this.stage.setChildIndex(this.blockList[this.dragGroup[b]].container, n);
            n -= 1;
        }

        this.refreshCanvas;
    }

    blockBlocks = this;
    return this;
}


function sendStackToTrash(blocks, myBlock) {
    var thisBlock = blocks.blockList.indexOf(myBlock);
    // disconnect block
    var b = myBlock.connections[0];
    if (b != null) {
        for (var c in blocks.blockList[b].connections) {
            if (blocks.blockList[b].connections[c] == thisBlock) {
                blocks.blockList[b].connections[c] = null;
                break;
            }
        }
        myBlock.connections[0] = null;
    }

    if (myBlock.name == 'start') {
        turtle = myBlock.value;
        if (turtle != null) {
            console.log('putting turtle ' + turtle + ' in the trash');
            blocks.turtles.turtleList[turtle].trash = true;
            blocks.turtles.turtleList[turtle].container.visible = false;
        } else {
            console.log('null turtle');
        }
    }

    if (myBlock.name == 'action') {
        var actionArg = blocks.blockList[myBlock.connections[1]];
        if (actionArg) {
            var actionName = actionArg.value;
            for (var blockId = 0; blockId < blocks.blockList.length; blockId++) {
                var myBlock = blocks.blockList[blockId];
                var blkParent = blocks.blockList[myBlock.connections[0]];
                if (blkParent == null) {
                    continue;
                }
                if (['nameddo', 'do', 'action'].indexOf(blkParent.name) != -1) {
                    continue;
                }
                var blockValue = myBlock.value;
                if (blockValue == _('action')) {
                    continue;
                }
                if (blockValue == actionName) {
                    blkParent.hide();
                    myBlock.hide();
                    myBlock.trash = true;
                    blkParent.trash = true;
                }
            }

            var blockPalette = blocks.palettes.dict['actions'];
            var blockRemoved = false;
            for (var blockId = 0; blockId < blockPalette.protoList.length; blockId++) {
                var block = blockPalette.protoList[blockId];
                // if (block.name == 'do' && block.defaults[0] != _('action') && block.defaults[0] == actionName) {
                if (block.name == 'nameddo' && block.privateData != _('action')) {
                    blockPalette.protoList.splice(blockPalette.protoList.indexOf(block), 1);
                    delete blocks.protoBlockDict['myDo_' + actionName];
                    blockPalette.y = 0;
                    blockRemoved = true;
                }
            }
            // Force an update if a block was removed.
            if (blockRemoved) {
                regeneratePalette(blockPalette);
            }
        }
    }

    // put drag group in trash
    blocks.findDragGroup(thisBlock);
    for (var b = 0; b < blocks.dragGroup.length; b++) {
        var blk = blocks.dragGroup[b];
        console.log('putting ' + blocks.blockList[blk].name + ' in the trash');
        blocks.blockList[blk].trash = true;
        blocks.blockList[blk].hide();
        blocks.refreshCanvas();
    }
}
