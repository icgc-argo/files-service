import _ from 'lodash';
import { File, FileLabel, QueryFilters } from './entity';
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

  fileToCreate.labels = new Array<FileLabel>();
  return await db.create(fileToCreate);
}

export async function addOrUpdateFileLabel(fileId: number, newLabels: FileLabel[]) {
  const file = await getFileRecordById(fileId);
  if (file == undefined) {
    throw new Errors.NotFound('No file for id ' + fileId);
  }

  validateLabels(newLabels);
  newLabels.forEach(label => {
    const newLabelKey = normalizeLabel(label.key);
    const existingLabel = file.labels.find(l => normalizeLabel(l.key) == newLabelKey);
    if (!existingLabel) {
      file.labels.push({
        key: newLabelKey,
        value: label.value || [],
      });
      return;
    }

    existingLabel.value = label.value || [];
    return;
  });
  return await db.update(file);
}

export async function removeLabel(fileId: number, keys: string[]) {
  const file = await getFileRecordById(fileId);
  if (file === undefined) {
    throw new Errors.NotFound('');
  }

  file.labels = file.labels.filter(l => !keys.includes(l.key));
  return await db.update(file);
}

const validateLabels = (labels: FileLabel[]) => {
  if (!labels || labels.length == 0) {
    throw new Errors.InvalidArgument('missing the labels');
  }
  labels.forEach((l, i) => {
    if (!l.key) {
      throw new Errors.InvalidArgument(`Label at index ${i}, is missing the "key" attribute`);
    }

    if (l.key.indexOf(',') !== -1) {
      throw new Errors.InvalidArgument(`Label at index ${i}, Keys cannot have comma in them.`);
    }

    const hasDuplicates =
      labels.filter(l2 => normalizeLabel(l2.key) == normalizeLabel(l.key)).length > 1;

    if (hasDuplicates) {
      throw new Errors.InvalidArgument(`Label at index ${i}, cannot submit duplicated label keys`);
    }
  });
};

const normalizeLabel = (key: string) => {
  return key.toLowerCase().trim();
};

export namespace Errors {
  export class InvalidArgument extends Error {
    constructor(message: string) {
      super(message);
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
