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

import mongoose from 'mongoose';
const AutoIncrement = require('mongoose-sequence')(mongoose);

export enum EmbargoStage {
  PROGRAM_ONLY = 'PROGRAM_ONLY',
  MEMBER_ACCESS = 'MEMBER_ACCESS',
  ASSOCIATE_ACCESS = 'ASSOCIATE_ACCESS',
  PUBLIC = 'PUBLIC',
}

export enum ReleaseState {
  RESTRICTED = 'RESTRICTED',
  QUEUED = 'QUEUED',
  PUBLIC = 'PUBLIC',
}

export type FileLabel = {
  key: string;
  value: string[];
};

const LabelSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: [String], required: false },
  },
  {
    _id: false,
  },
);
interface DbFile {
  objectId: string;
  fileId?: number;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;

  firstPublished: Date;

  embargoStage: string;
  releaseState: string;

  labels: FileLabel[];
}

export interface File {
  fileId?: string;
  objectId: string;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;

  firstPublished: Date;
  embargoStage: EmbargoStage;
  releaseState: ReleaseState;

  labels: FileLabel[];
}

const FileSchema = new mongoose.Schema(
  {
    fileId: { type: Number, index: true, unique: true },
    objectId: { type: String, required: true, unique: true },
    repoId: { type: String, required: true },

    programId: { type: String, required: true },
    donorId: { type: String, required: true },
    analysisId: { type: String, required: true },

    firstPublished: { type: Date, required: true },
    embargoStage: {
      type: String,
      required: true,
      enum: Object.values(EmbargoStage),
      default: EmbargoStage.PROGRAM_ONLY,
    },
    releaseState: {
      type: String,
      required: true,
      enum: Object.values(EmbargoStage),
      default: ReleaseState.RESTRICTED,
    },

    labels: [LabelSchema],
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

export type QueryFilters = {
  analysisId?: string[];
  programId?: string[];
  objectId?: string[];
};

FileSchema.plugin(AutoIncrement, {
  inc_field: 'fileId',
});

export type FileDocument = mongoose.Document & DbFile;

export async function getFiles(filters: QueryFilters) {
  return (await FileModel.find(buildQueryFilters(filters)).exec()) as FileDocument[];
}

export async function getFileRecordById(id: number) {
  return await FileModel.findOne({ fileId: id });
}

export async function getFileRecordByObjId(objId: string) {
  return await FileModel.findOne({
    objectId: objId,
  });
}

export async function create(file: File) {
  const newFile = new FileModel(file);
  const createdFile = await newFile.save();
  return createdFile;
}

export async function update(toUpdate: FileDocument) {
  const updatedFile = await toUpdate.save();
  return updatedFile;
}

export async function deleteAll(ids: number[]) {
  if (!ids || ids.length == 0) {
    await FileModel.deleteMany({});
    return;
  }

  await FileModel.deleteMany({
    fileId: {
      $in: ids,
    },
  });
}

export let FileModel = mongoose.model<FileDocument>('File', FileSchema);

function buildQueryFilters(filters: QueryFilters) {
  const queryFilters: mongoose.MongooseFilterQuery<FileDocument> = {};
  if (filters.analysisId && filters.analysisId.length > 0) {
    queryFilters.analysisId = {
      $in: filters.analysisId,
    };
  }
  if (filters.programId && filters.programId.length > 0) {
    queryFilters.programId = {
      $in: filters.programId,
    };
  }
  if (filters.objectId && filters.objectId.length > 0) {
    queryFilters.objectId = {
      $in: filters.objectId,
    };
  }
  return queryFilters;
}
