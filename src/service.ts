import _ from 'lodash';
import { File, QueryFilters } from './entity';
import * as db from './model';

export async function getFiles(filters: QueryFilters) {
  return await db.getFiles(filters);
}

export async function getFileRecordById(id: number): Promise<File | undefined> {
  const file = await db.getFileRecordById(id);
  if (file == undefined) {
    throw new Errors.NotFound('no file found for this id ');
  }
  return file;
}

export async function getFileRecordByObjId(objId: string): Promise<File | undefined> {
  return await db.getFileRecordByObjId(objId);
}

export async function getOrCreateFileRecordByObjId(fileToCreate: File): Promise<File> {
  const file = await getFileRecordByObjId(fileToCreate.objectId);
  if (file != undefined) {
    return file;
  }
  // todo : validate labels1
  return await db.create(fileToCreate);
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
  return await db.update(file);
}

export async function removeLabel(fileId: number, key: string) {
  const file = await getFileRecordById(fileId);
  if (file === undefined) {
    throw new Errors.NotFound('');
  }
  _.unset(file.labels, key);
  return await db.update(file);
}

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
