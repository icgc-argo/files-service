import mongoose from 'mongoose';
const AutoIncrement = require('mongoose-sequence')(mongoose);
import _ from 'lodash';

export async function getFileRecordById(id: number): Promise<File | undefined> {
  return (await FileModel.findOne({ fileId: id })
    .lean()
    .exec()) as File | undefined;
}

export async function getFileRecordByObjId(objId: string): Promise<File | undefined> {
  return (await FileModel.findOne({
    objectId: objId,
  })
    .lean()
    .exec()) as File | undefined;
}

export async function getOrCreateFileRecordByObjId(fileToCreate: File): Promise<File> {
  const file = await getFileRecordByObjId(fileToCreate.objectId);
  if (file != undefined) {
    return file;
  }
  const newFile = new FileModel(fileToCreate);
  const createdFile = await newFile.save();
  return toPojo(createdFile);
}

export async function addOrUpdateFileLabel(
  fileId: number,
  newLabels: { key: string; value: string[] },
) {
  const file = await getFileRecordById(fileId);
  if (file === undefined) {
    throw new Errors.NotFound('');
  }
  _.merge(file.labels, newLabels);
  const toUpdate = new FileModel(file);
  unsetIsNewFlagForUpdate(file);
  const updatedFile = await toUpdate.save();
  return toPojo(updatedFile);
}

export async function removeLabel(fileId: number, key: string) {
  const file = await getFileRecordById(fileId);
  if (file === undefined) {
    throw new Errors.NotFound('');
  }
  _.unset(file.labels, key);
  const toUpdate = new FileModel(file);
  unsetIsNewFlagForUpdate(file);
  const updatedFile = await toUpdate.save();
  return toPojo(updatedFile);
}

function unsetIsNewFlagForUpdate(file: File) {
  (file as any).isNew = false;
}

export interface File {
  fileId?: number;
  objectId: string;
  repoId: string;
  programId: string;
  analysisId: string;
  labels: { [key: string]: string[] };
}

const FileSchema = new mongoose.Schema(
  {
    fileId: { type: Number, index: true, unique: true },
    objectId: { type: String, required: true, unique: true },
    repoId: { type: String, required: true },
    analysisId: { type: String, required: true },
    labels: {},
  },
  { timestamps: true, minimize: false },
);

FileSchema.plugin(AutoIncrement, {
  inc_field: 'fileId',
});

type FileDocument = mongoose.Document & File;

export let FileModel = mongoose.model<FileDocument>('File', FileSchema);

export const toPojo = (doc: mongoose.Document) => {
  const pojo = doc.toObject();
  if (pojo._id) {
    pojo._id = pojo._id.toString();
  }
  return pojo;
};

export namespace Errors {
  export class InvalidArgument extends Error {
    constructor(argumentName: string) {
      super(`Invalid argument : ${argumentName}`);
    }
  }

  export class NotFound extends Error {
    constructor(msg: string) {
      super(msg);
    }
  }

  export class StateConflict extends Error {
    constructor(msg: string) {
      super(msg);
    }
  }
}
