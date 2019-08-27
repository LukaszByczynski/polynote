'use strict';

import {
    arrayCodec, bool, bufferCodec, Codec, combined, discriminated, either, float64, int16, int32, mapCodec, optional,
    Pair, shortStr, str, tinyStr, uint16, uint32, uint8
} from './codec'

import {KernelErrorWithCause, Output, PosRange, Result} from './result'
import {StreamingDataRepr} from "./value_repr";
import {isEqual} from "../util/functions";
import {CellMetadata, NotebookCell, NotebookConfig} from "./data";
import {ContentEdit, Delete, Insert} from "./content_edit";

export class Message {
    static decode(data) {
        return Codec.decode(Message.codec, data);
    }

    static encode(msg) {
        return Codec.encode(Message.codec, msg);
    }

    encode() {
        return Message.encode(this);
    }

    isResponse(other) {
        return false;
    }
}

export class Error extends Message {
    static get msgTypeId() { return 0; }

    static unapply(inst) {
        return [inst.code, inst.error];
    }

    constructor(code, error) {
        super(code, error);
        this.code = code;
        this.error = error;
        Object.freeze(this);
    }
}

Error.codec = combined(uint16, KernelErrorWithCause.codec).to(Error);

export class LoadNotebook extends Message {
    static get msgTypeId() { return 1; }

    static unapply(inst) {
        return [inst.path];
    }

    constructor(path) {
        super(path);
        this.path = path;
        Object.freeze(this);
    }
}

LoadNotebook.codec = combined(shortStr).to(LoadNotebook);

export class NotebookCells extends Message {
    static get msgTypeId() { return 2; }

    static unapply(inst) {
        return [inst.path, inst.cells, inst.config];
    }

    constructor(path, cells, config) {
        super(path, cells);
        this.path = path;
        this.cells = cells;
        this.config = config;
        Object.freeze(this);
    }
}

NotebookCells.codec =
    combined(shortStr, arrayCodec(uint16, NotebookCell.codec), optional(NotebookConfig.codec)).to(NotebookCells);

export class RunCell extends Message {
    static get msgTypeId() { return 3; }

    static unapply(inst) {
        return [inst.notebook, inst.ids];
    }

    constructor(notebook, ids) {
        super(notebook, ids);
        this.notebook = notebook;
        this.ids = ids;
        Object.freeze(this);
    }
}

RunCell.codec = combined(shortStr, arrayCodec(uint16, uint16)).to(RunCell);

export class CellResult extends Message {
    static get msgTypeId() { return 4; }

    static unapply(inst) {
        return [inst.notebook, inst.id, inst.result]
    }

    constructor(notebook, id, result) {
        super(notebook, id, result);
        this.notebook = notebook;
        this.id = id;
        this.result = result;
        Object.freeze(this);
    }
}

CellResult.codec = combined(shortStr, int16, Result.codec).to(CellResult);


export class NotebookUpdate extends Message {

    static unapply(inst) { return [inst]; }

    /**
     * Transform a so that it has the same effect when applied after b. Returns transformed a.
     * @seeScala polynote.messages.NotebookUpdate#rebase
     */
    static rebase(a, b) {
        if (b instanceof Array) {
            let accum = a;
            b.forEach(update => {
                accum = NotebookUpdate.rebase(accum, update);
            });
            return accum;
        }

        if (a instanceof InsertCell && b instanceof InsertCell && a.after === b.after) {
            return new InsertCell(a.path, a.globalVersion, a.localVersion, b.cell.id);
        } else if (a instanceof UpdateCell && b instanceof UpdateCell && a.id === b.id) {
            return new UpdateCell(a.path, a.globalVersion, a.localVersion, ContentEdit.rebaseEdits(a.edits, b.edits));
        } else {
            return a;
        }
    }

}

export class UpdateCell extends NotebookUpdate {
    static get msgTypeId() { return 5; }

    static unapply(inst) {
        return [inst.path, inst.globalVersion, inst.localVersion, inst.id, inst.edits, inst.metadata];
    }

    constructor(path, globalVersion, localVersion, id, edits, metadata) {
        super(path, globalVersion, localVersion, id, edits);
        this.path = path;
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.id = id;
        this.edits = edits;
        this.metadata = metadata;
        Object.freeze(this);
    }
}

UpdateCell.codec = combined(shortStr, uint32, uint32, int16, arrayCodec(uint16, ContentEdit.codec), optional(CellMetadata.codec)).to(UpdateCell);

export class InsertCell extends NotebookUpdate {
    static get msgTypeId() { return 6; }

    static unapply(inst) {
        return [inst.path, inst.globalVersion, inst.localVersion, inst.cell, inst.after];
    }

    constructor(path, globalVersion, localVersion, cell, after) {
        super(path, globalVersion, localVersion, cell, after);
        this.path = path;
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.cell = cell;
        this.after = after;
        Object.freeze(this);
    }
}

InsertCell.codec = combined(shortStr, uint32, uint32, NotebookCell.codec, int16).to(InsertCell);

export class ParamInfo {
    static unapply(inst) {
        return [inst.name, inst.type];
    }

    constructor(name, type) {
        this.name = name;
        this.type = type;
        Object.freeze(this);
    }
}

ParamInfo.codec = combined(tinyStr, shortStr).to(ParamInfo);

export class CompletionCandidate {
    static unapply(inst) {
        return [inst.name, inst.typeParams, inst.params, inst.type, inst.completionType];
    }

    constructor(name, typeParams, params, type, completionType) {
        this.name = name;
        this.typeParams = typeParams;
        this.params = params;
        this.type = type;
        this.completionType = completionType;
        Object.freeze(this);
    }
}

CompletionCandidate.codec =
    combined(tinyStr, arrayCodec(uint8, tinyStr), arrayCodec(uint8, arrayCodec(uint8, ParamInfo.codec)), shortStr, uint8).to(CompletionCandidate);

export class CompletionsAt extends Message {
    static get msgTypeId() { return 7; }

    static unapply(inst) {
        return [inst.notebook, inst.id, inst.pos, inst.completions];
    }

    constructor(notebook, id, pos, completions) {
        super(notebook, id, pos);
        this.notebook = notebook;
        this.id = id;
        this.pos = pos;
        this.completions = completions;
        Object.freeze(this);
    }
}

CompletionsAt.codec =
    combined(shortStr, int16, int32, arrayCodec(uint16, CompletionCandidate.codec)).to(CompletionsAt);

export class ParameterHint {
    static unapply(inst) {
        return [inst.name, inst.typeName, inst.docString];
    }

    constructor(name, typeName, docString) {
        this.name = name;
        this.typeName = typeName;
        this.docString = docString;
        Object.freeze(this);
    }
}

ParameterHint.codec = combined(tinyStr, tinyStr, optional(shortStr)).to(ParameterHint);

export class ParameterHints {
    static unapply(inst) {
        return [inst.name, inst.docString, inst.parameters];
    }

    constructor(name, docString, parameters) {
        this.name = name;
        this.docString = docString;
        this.parameters = parameters;
        Object.freeze(this);
    }
}

ParameterHints.codec = combined(tinyStr, optional(shortStr), arrayCodec(uint8, ParameterHint.codec)).to(ParameterHints);

export class Signatures {
    static unapply(inst) {
        return [inst.hints, inst.activeSignature, inst.activeParameter];
    }

    constructor(hints, activeSignature, activeParameter) {
        this.hints = hints;
        this.activeSignature = activeSignature;
        this.activeParameter = activeParameter;
        Object.freeze(this);
    }
}

Signatures.codec = combined(arrayCodec(uint8, ParameterHints.codec), uint8, uint8).to(Signatures);

export class ParametersAt extends Message {
    static get msgTypeId() { return 8; }

    static unapply(inst) {
        return [inst.notebook, inst.id, inst.pos, inst.signatures];
    }

    constructor(notebook, id, pos, signatures) {
        super(notebook, id, pos, signatures);
        this.notebook = notebook;
        this.id = id;
        this.pos = pos;
        this.signatures = signatures;
        Object.freeze(this);
    }
}

ParametersAt.codec = combined(shortStr, int16, int32, optional(Signatures.codec)).to(ParametersAt);

export class KernelStatusUpdate {
   constructor() {

   }
}

export class SymbolInfo {
    static unapply(inst) {
        return [inst.name, inst.typeName, inst.valueText, inst.availableViews];
    }

    constructor(name, typeName, valueText, availableViews) {
        this.name = name;
        this.typeName = typeName;
        this.valueText = valueText;
        this.availableViews = availableViews;
        Object.freeze(this);
    }
}

SymbolInfo.codec = combined(tinyStr, tinyStr, tinyStr, arrayCodec(uint8, tinyStr)).to(SymbolInfo);

export class UpdatedSymbols extends KernelStatusUpdate {
    static get msgTypeId() { return 0; }

    static unapply(inst) {
        return [inst.newOrUpdated, inst.removed];
    }

    constructor(newOrUpdated, removed) {
        super(newOrUpdated, removed);
        this.newOrUpdated = newOrUpdated;
        this.removed = removed;
        Object.freeze(this);
    }
}

UpdatedSymbols.codec = combined(arrayCodec(uint8, SymbolInfo.codec), arrayCodec(uint8, tinyStr)).to(UpdatedSymbols);

export const TaskStatus = Object.freeze({
    Complete: 0,
    Running: 1,
    Queued: 2,
    Error: 3
});

export class TaskInfo {
    static unapply(inst) {
        return [inst.id, inst.label, inst.detail, inst.status, inst.progress];
    }

    constructor(id, label, detail, status, progress) {
        this.id = id;
        this.label = label;
        this.detail = detail;
        this.status = status;
        this.progress = progress;
        Object.freeze(this);
    }
}

TaskInfo.codec = combined(tinyStr, tinyStr, shortStr, uint8, uint8).to(TaskInfo);

export class UpdatedTasks extends KernelStatusUpdate {
    static get msgTypeId() { return 1; }

    static unapply(inst) {
        return [inst.tasks];
    }

    constructor(tasks) {
        super(tasks);
        this.tasks = tasks;
        Object.freeze(this);
    }
}

UpdatedTasks.codec = combined(arrayCodec(uint8, TaskInfo.codec)).to(UpdatedTasks);

export class KernelBusyState extends KernelStatusUpdate {
    static get msgTypeId() { return 2; }

    static unapply(inst) {
        return [inst.busy, inst.alive];
    }

    constructor(busy, alive) {
        super(busy, alive);
        this.busy = busy;
        this.alive = alive;
        Object.freeze(this);
    }
}

KernelBusyState.codec = combined(bool, bool).to(KernelBusyState);

export class KernelInfo extends KernelStatusUpdate {
    static get msgTypeId() { return 3; }

    static unapply(inst) {
        return [inst.content];
    }

    constructor(content) {
        super(content);
        this.content = content;
        Object.freeze(this);
    }
}

KernelInfo.codec = combined(mapCodec(uint8, shortStr, str)).to(KernelInfo);

export class ExecutionStatus extends KernelStatusUpdate {
    static get msgTypeId() { return 4; }

    static unapply(inst) {
        return [inst.cellId, inst.pos];
    }

    constructor(cellId, pos) {
        super(cellId, pos);
        this.cellId = cellId;
        this.pos = pos;
        Object.freeze(this);
    }
}

ExecutionStatus.codec = combined(int16, optional(PosRange.codec)).to(ExecutionStatus);

KernelStatusUpdate.codecs = [
    UpdatedSymbols,   // 0
    UpdatedTasks,     // 1
    KernelBusyState,  // 2
    KernelInfo,       // 3
    ExecutionStatus,  // 4
];

KernelStatusUpdate.codec = discriminated(
    uint8,
    msgTypeId => KernelStatusUpdate.codecs[msgTypeId].codec,
    msg => msg.constructor.msgTypeId
);

export class KernelStatus extends Message {
    static get msgTypeId() { return 9; }
    static unapply(inst) {
        return [inst.path, inst.update];
    }

    constructor(path, update) {
        super(path, update);
        this.path = path;
        this.update = update;
        Object.freeze(this);
    }
}

KernelStatus.codec = combined(shortStr, KernelStatusUpdate.codec).to(KernelStatus);

export class UpdateConfig extends NotebookUpdate {
    static get msgTypeId() { return 10; }
    static unapply(inst) {
        return [inst.path, inst.globalVersion, inst.localVersion, inst.config];
    }

    constructor(path, globalVersion, localVersion, config) {
        super(path, globalVersion, localVersion, config);
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.path = path;
        this.config = config;
        Object.freeze(this);
    }
}

UpdateConfig.codec = combined(shortStr, uint32, uint32, NotebookConfig.codec).to(UpdateConfig);

export class SetCellLanguage extends NotebookUpdate {
    static get msgTypeId() { return 11; }
    static unapply(inst) {
        return [inst.path, inst.globalVersion, inst.localVersion, inst.id, inst.language];
    }

    constructor(path, globalVersion, localVersion, id, language) {
        super(path, globalVersion, localVersion, id, language);
        this.path = path;
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.id = id;
        this.language = language;
        Object.freeze(this);
    }
}

SetCellLanguage.codec = combined(shortStr, uint32, uint32, int16, tinyStr).to(SetCellLanguage);

export class StartKernel extends Message {
    static get msgTypeId() { return 12; }
    static unapply(inst) {
        return [inst.path, inst.level];
    }

    constructor(path, level) {
        super(path, level);
        this.path = path;
        this.level = level;
        Object.freeze(this);
    }

    static get NoRestart() { return 0; }
    static get WarmRestart() { return 1; }
    static get ColdRestart() { return 2; }
    static get Kill() { return 3; }
}

StartKernel.codec = combined(shortStr, uint8).to(StartKernel);

export class ListNotebooks extends Message {
    static get msgTypeId() { return 13; }
    static unapply(inst) {
        return [inst.notebooks];
    }

    constructor(notebooks) {
        super(notebooks);
        this.notebooks = notebooks;
        Object.freeze(this);
    }
}

ListNotebooks.codec = combined(arrayCodec(int32, shortStr)).to(ListNotebooks);

export class CreateNotebook extends Message {
    static get msgTypeId() { return 14; }
    static unapply(inst) {
        return [inst.path, inst.uriOrContents];
    }

    constructor(path, uriOrContents) {
        super(path, uriOrContents);
        this.path = path;
        this.uriOrContents = uriOrContents;
        Object.freeze(this);
    }
}

CreateNotebook.codec = combined(shortStr, optional(either(shortStr, str))).to(CreateNotebook);

export class DeleteCell extends NotebookUpdate {
    static get msgTypeId() { return 15; }
    static unapply(inst) {
        return [inst.path, inst.globalVersion, inst.localVersion, inst.id];
    }

    constructor(path, globalVersion, localVersion, id) {
        super(path, globalVersion, localVersion, id);
        this.path = path;
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.id = id;
        Object.freeze(this);
    }
}

DeleteCell.codec = combined(shortStr, uint32, uint32, int16).to(DeleteCell);

export class ServerHandshake extends Message {
    static get msgTypeId() { return 16; }
    static unapply(inst) {
        return [inst.interpreters, inst.serverVersion, inst.serverCommit];
    }

    constructor(interpreters, serverVersion, serverCommit) {
        super(interpreters, serverVersion, serverCommit);
        this.interpreters = interpreters;
        this.serverVersion = serverVersion;
        this.serverCommit = serverCommit;
        Object.freeze(this);
    }
}

ServerHandshake.codec = combined(mapCodec(uint8, tinyStr, tinyStr), tinyStr, tinyStr).to(ServerHandshake);

export class HandleData extends Message {
    static get msgTypeId() { return 17; }
    static unapply(inst) {
        return [inst.path, inst.handleType, inst.handle, inst.count, inst.data];
    }

    constructor(path, handleType, handle, count, data) {
        super(path, handleType, handle, count, data);
        this.path = path;
        this.handleType = handleType;
        this.handle = handle;
        this.count = count;
        this.data = data;
        Object.freeze(this);
    }
}

HandleData.codec = combined(shortStr, uint8, int32, int32, arrayCodec(int32, bufferCodec)).to(HandleData);

export class CancelTasks extends Message {
    static get msgTypeId() { return 18; }
    static unapply(inst) { return [inst.path]; }

    constructor(path) {
        super(path);
        this.path = path;
        Object.freeze(this);
    }
}

CancelTasks.codec = combined(shortStr).to(CancelTasks);

export class TableOp {}
export class GroupAgg extends TableOp {
    static get msgTypeId() { return 0; }
    static unapply(inst) { return [inst.columns, inst.aggregations]; }

    constructor(columns, aggregations) {
        super(columns, aggregations);
        this.columns = columns;
        this.aggregations = aggregations;
        Object.freeze(this);
    }
}

GroupAgg.codec = combined(arrayCodec(int32, str), arrayCodec(int32, Pair.codec(str, str))).to(GroupAgg);

export class QuantileBin extends TableOp {
    static get msgTypeId() { return 1; }
    static unapply(inst) { return [inst.column, inst.binCount, inst.err]; }
    constructor(column, binCount, err) {
        super(column, binCount, err);
        this.column = column;
        this.binCount = binCount;
        this.err = err;
        Object.freeze(this);
    }
}

QuantileBin.codec = combined(str, int32, float64).to(QuantileBin);

export class Select extends TableOp {
    static get msgTypeId() { return 2; }
    static unapply(inst) { return [inst.columns]; }
    constructor(columns) {
        super(columns);
        this.columns = columns;
        Object.freeze(this);
    }
}

Select.codec = combined(arrayCodec(int32, str)).to(Select);

TableOp.codecs = [
    GroupAgg,
    QuantileBin,
    Select
];

TableOp.codec = discriminated(uint8, msgTypeId => TableOp.codecs[msgTypeId].codec, msg => msg.constructor.msgTypeId);

export class ModifyStream extends Message {
    static get msgTypeId() { return 19; }
    static unapply(inst) { return [inst.path, inst.fromHandle, inst.ops, inst.newRepr]; }
    constructor(path, fromHandle, ops, newRepr) {
        super(path, fromHandle, ops, newRepr);
        this.path = path;
        this.fromHandle = fromHandle;
        this.ops = ops;
        this.newRepr = newRepr;
        Object.freeze(this);
    }

    isResponse(other) {
        if (!(other instanceof ModifyStream) || other.path !== this.path || other.fromHandle !== this.fromHandle)
            return false;

        return isEqual(this.ops, other.ops);
    }
}

ModifyStream.codec = combined(shortStr, int32, arrayCodec(uint8, TableOp.codec), optional(StreamingDataRepr.codec)).to(ModifyStream);

export class ReleaseHandle extends Message {
    static get msgTypeId() { return 20; }
    static unapply(inst) { return [inst.path, inst.handleType, inst.handleId]; }
    constructor(path, handleType, handleId) {
        super(path, handleType, handleId);
        this.path = path;
        this.handleType = handleType;
        this.handleId = handleId;
        Object.freeze(this);
    }

    isResponse(other) {
        return other instanceof ReleaseHandle &&
            other.path === this.path &&
            other.handleType === this.handleType &&
            other.handleId === this.handleId;
    }
}

ReleaseHandle.codec = combined(shortStr, uint8, int32).to(ReleaseHandle);

export class ClearOutput extends Message {
    static get msgTypeId() { return 21; }

    static unapply(inst) {
        return [inst.path];
    }

    constructor(path) {
        super(path);
        this.path = path;
        Object.freeze(this);
    }
}

ClearOutput.codec = combined(shortStr).to(ClearOutput);

export class SetCellOutput extends NotebookUpdate {
    static get msgTypeId() { return 22; }
    static unapply(inst) { return [inst.path, inst.globalVersion, inst.localVersion, inst.id, inst.output]}

    constructor(path, globalVersion, localVersion, id, output) {
        super(path, globalVersion, localVersion, id, output);
        this.path = path;
        this.globalVersion = globalVersion;
        this.localVersion = localVersion;
        this.id = id;
        this.output = output;
        Object.freeze(this);
    }
}

SetCellOutput.codec = combined(shortStr, uint32, uint32, int16, optional(Output.codec)).to(SetCellOutput);

export class NotebookVersion extends Message {
    static get msgTypeId() { return 23; }

    static unapply(inst) {
        return [inst.path, inst.globalVersion];
    }

    constructor(path, globalVersion) {
        super(path, globalVersion);
        this.path = path;
        this.globalVersion = globalVersion;
        Object.freeze(this);
    }
}

NotebookVersion.codec = combined(shortStr, uint32).to(NotebookVersion);

export class RunningKernels extends Message {
    static get msgTypeId() { return 24; }

    static unapply(inst) {
        return [inst.kernelStatuses];
    }

    constructor(kernelStatuses) {
        super(kernelStatuses);
        this.kernelStatuses = kernelStatuses;
        Object.freeze(this);
    }

    isResponse(other) {
        return other instanceof RunningKernels
    }
}

RunningKernels.codec = combined(arrayCodec(uint8, KernelStatus.codec)).to(RunningKernels);

Message.codecs = [
    Error,           // 0
    LoadNotebook,    // 1
    NotebookCells,   // 2
    RunCell,         // 3
    CellResult,      // 4
    UpdateCell,      // 5
    InsertCell,      // 6
    CompletionsAt,   // 7
    ParametersAt,    // 8
    KernelStatus,    // 9
    UpdateConfig,    // 10
    SetCellLanguage, // 11
    StartKernel,     // 12
    ListNotebooks,   // 13
    CreateNotebook,  // 14
    DeleteCell,      // 15
    ServerHandshake, // 16
    HandleData,      // 17
    CancelTasks,     // 18
    ModifyStream,    // 19
    ReleaseHandle,   // 20
    ClearOutput,     // 21
    SetCellOutput,   // 22
    NotebookVersion, // 23
    RunningKernels,  // 24
];


Message.codec = discriminated(
    uint8,
    (msgTypeId) => Message.codecs[msgTypeId].codec,
    (msg) => msg.constructor.msgTypeId
);

