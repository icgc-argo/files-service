/*
 * Copyright (c) 2020 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import _ from 'lodash';
import { File, FileLabel, QueryFilters } from './file.model';
import * as fileModel from './file.model';

export async function getFiles(filters: QueryFilters) {
  return (await fileModel.getFiles(filters)).map(toPojo);
}

export async function getFileRecordById(fileId: string) {
  const file = await getFileAsDoc(toNumericId(fileId));
  return toPojo(file);
}

export async function getFileRecordByObjId(objId: string) {
  const file = await fileModel.getFileRecordByObjId(objId);
  if (!file) {
    throw new Errors.NotFound('no file found for objId: ' + objId);
  }
  return toPojo(file);
}

export async function getOrCreateFileRecordByObjId(fileToCreate: File) {
  const file = await fileModel.getFileRecordByObjId(fileToCreate.objectId);
  if (file != undefined) {
    return toPojo(file);
  }

  fileToCreate.labels = new Array<FileLabel>();
  return toPojo(await fileModel.create(fileToCreate));
}

export async function addOrUpdateFileLabel(fileId: string, newLabels: FileLabel[]) {
  const file = await getFileAsDoc(toNumericId(fileId));
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
  return toPojo(await fileModel.update(file));
}

export async function removeLabel(fileId: string, keys: string[]) {
  const file = await getFileAsDoc(toNumericId(fileId));
  file.labels = file.labels.filter(l => !keys.includes(l.key));
  const updated = await fileModel.update(file);
  return toPojo(updated);
}

export async function deleteAll(ids: string[]) {
  await fileModel.deleteAll(ids.map(toNumericId));
}

function toNumericId(id: string) {
  if (!id.startsWith('FL')) {
    throw new Errors.InvalidArgument('file id should start with FL, example: FL1234');
  }
  const numId = Number(id.substr(2, id.length - 2));
  if (!numId || numId == Number.NaN) {
    throw new Errors.InvalidArgument(`id ${id} is not a valid`);
  }
  return numId;
}

async function getFileAsDoc(id: number): Promise<fileModel.FileDocument> {
  const file = await fileModel.getFileRecordById(id);
  if (file == undefined) {
    throw new Errors.NotFound('no file found for this id ');
  }
  return file;
}

function toPojo(f: fileModel.FileDocument) {
  if (!f) {
    throw new Error('cannot convert undefined');
  }
  return {
    analysisId: f.analysisId,
    labels: f.labels,
    objectId: f.objectId,
    programId: f.programId,
    repoId: f.repoId,
    fileId: `FL${f.fileId}`,
  } as File;
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
