import _ from 'lodash';
import { File, FileLabels, QueryFilters } from './entity';
import * as db from './model';

export async function getFiles(filters: QueryFilters) {
  return await db.getFiles(filters);
}

export async function getFileRecordById(id: number) {
  const file = await db.getFileRecordById(id);
  if (file == undefined) {
    throw new Errors.NotFound('no file found for this id ');
  }
  return file;
}

export async function getFileRecordByObjId(objId: string) {
  return await db.getFileRecordByObjId(objId);
}

export async function getOrCreateFileRecordByObjId(fileToCreate: File) {
  const file = await getFileRecordByObjId(fileToCreate.objectId);
  if (file != undefined) {
    return file;
  }

  fileToCreate.labels = {};
  return await db.create(fileToCreate);
}

export async function addOrUpdateFileLabel(fileId: number, newLabels: FileLabels) {
  const file = await getFileRecordById(fileId);
  if (file == undefined) {
    throw new Errors.NotFound('No file for id ' + fileId);
  }
  validateLabels(newLabels);
  Object.keys(newLabels).forEach(k => {
    const labelValue = newLabels[k];
    file.labels[k] = labelValue || [];
  });
  file.markModified('labels');
  return await db.update(file);
}

export async function removeLabel(fileId: number, keys: string[]) {
  const file = await getFileRecordById(fileId);
  if (file === undefined) {
    throw new Errors.NotFound('');
  }
  keys.forEach(k => {
    _.unset(file.labels, k);
  });
  file.markModified('labels');
  return await db.update(file);
}

const validateLabels = (labels: FileLabels) => {
  Object.keys(labels).forEach(k => {
    if (k.indexOf(',') !== -1) {
      throw new Errors.InvalidArgument('Keys cannot have comma in them.');
    }
  });
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
