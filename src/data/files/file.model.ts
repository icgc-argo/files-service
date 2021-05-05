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

export enum FileReleaseState {
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

// DbFile has the types we get back out  of the DB (before casting strings to enums)
interface DbFile {
  objectId: string;
  fileId: number;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;
  firstPublished?: Date;

  embargoStage: string;
  releaseState: string;

  adminPromote?: string;
  adminHold?: boolean;

  labels: FileLabel[];
}

// File is the POJO with proper types for a document read from the DB
export interface File {
  fileId: string;
  objectId: string;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;
  firstPublished?: Date;

  embargoStage: EmbargoStage;
  releaseState: FileReleaseState;

  adminPromote?: EmbargoStage;
  adminHold?: boolean;

  labels: FileLabel[];
}

// FileInput matches the File object, but with optional fields where
//  values may not want to be provided when doing an update or creating
//  a new File and plannign to use the default values
export interface FileInput {
  fileId?: string;
  objectId: string;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;
  firstPublished?: Date;

  embargoStage?: EmbargoStage;
  releaseState?: FileReleaseState;

  adminPromote?: EmbargoStage;
  adminHold?: boolean;

  labels: FileLabel[];
}

const FileSchema = new mongoose.Schema(
  {
    fileId: { type: Number, index: true, unique: true },
    objectId: { type: String, required: true, unique: true },
    repoId: { type: String, required: true },
    status: { type: String, required: true },

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
      enum: Object.values(FileReleaseState),
      default: FileReleaseState.RESTRICTED,
    },

    adminPromote: {
      type: String,
      required: false,
      enum: Object.values(EmbargoStage),
    },
    adminHold: { type: Boolean, required: false },

    labels: [LabelSchema],
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

export type QueryFilters = {
  analysisId?: string[];
  programId?: string[];
  objectId?: string[];
};

/**
 * As described in swagger schema: #/components/schemas/FileFilter
 */
export interface FileFilterProperties {
  analyses?: string[];
  donors?: string[];
  programs?: string[];
  objectIds?: string[];
  fileIds?: string[];
}
export interface FileFilter {
  include?: FileFilterProperties;
  exclude?: FileFilterProperties;
}
export interface FileStateFilter {
  embargoStage?: EmbargoStage;
  releaseState?: FileReleaseState;
}

FileSchema.plugin(AutoIncrement, {
  inc_field: 'fileId',
});

export type FileMongooseDocument = mongoose.Document & DbFile;

export async function getFiles(filters: FileFilter) {
  return (await FileModel.find(
    convertFiltersForMongoose(filters),
  ).exec()) as FileMongooseDocument[];
}
export async function getFilesQuery(filters: QueryFilters) {
  return (await FileModel.find(buildQueryFilters(filters)).exec()) as FileMongooseDocument[];
}

export async function getFileById(id: number) {
  return await FileModel.findOne({ fileId: id });
}

export async function getFileByObjId(objId: string) {
  return await FileModel.findOne({
    objectId: objId,
  });
}

export async function getFilesByState(filter: FileStateFilter) {
  return (await FileModel.find(filter).exec()) as FileMongooseDocument[];
}

export async function create(file: FileInput) {
  const newFile = new FileModel(file);
  return await newFile.save();
}

export async function save(toUpdate: FileMongooseDocument) {
  const updatedFile = await toUpdate.save();
  return updatedFile;
}

export async function updateByObjectId(
  objectId: string,
  updates: mongoose.UpdateQuery<FileMongooseDocument>,
  options: any,
) {
  return await FileModel.findOneAndUpdate({ objectId }, updates, {
    ...options,
    useFindAndModify: false,
  });
}

export async function updateBulk(
  filter: FileFilter,
  updates: mongoose.UpdateQuery<FileMongooseDocument>,
  options?: { returnDocuments: boolean },
) {
  const mongooseFilter = convertFiltersForMongoose(filter);
  await FileModel.updateMany(mongooseFilter, updates);
  if (options?.returnDocuments) {
    return FileModel.find(mongooseFilter);
  }
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

const FileModel = mongoose.model<FileMongooseDocument>('File', FileSchema);

function buildQueryFilters(filters: QueryFilters) {
  const queryFilters: mongoose.MongooseFilterQuery<FileMongooseDocument> = {};
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
const fileIdFromString = (fileId: string): number => {
  return parseInt(fileId.replace(/^FL/, ''));
};

function convertFiltersForMongoose(filters: FileFilter) {
  const queryFilters: mongoose.MongooseFilterQuery<FileMongooseDocument> = {};
  if (filters.include) {
    if (filters.include.analyses && filters.include.analyses.length > 0) {
      queryFilters.analysisId = {
        $in: filters.include.analyses,
      };
    }
    if (filters.include.programs && filters.include.programs.length > 0) {
      queryFilters.programId = {
        $in: filters.include.programs,
      };
    }
    if (filters.include.donors && filters.include.donors.length > 0) {
      queryFilters.donorId = {
        $in: filters.include.donors,
      };
    }
    if (filters.include.objectIds && filters.include.objectIds.length > 0) {
      queryFilters.objectId = {
        $in: filters.include.objectIds,
      };
    }
    if (filters.include.fileIds && filters.include.fileIds.length > 0) {
      queryFilters.fileId = {
        $in: filters.include.fileIds.map(fileIdFromString),
      };
    }
  }

  if (filters.exclude) {
    if (filters.exclude.analyses && filters.exclude.analyses.length > 0) {
      queryFilters.analysisId = {
        $nin: filters.exclude.analyses,
      };
    }
    if (filters.exclude.programs && filters.exclude.programs.length > 0) {
      queryFilters.programId = {
        $nin: filters.exclude.programs,
      };
    }
    if (filters.exclude.donors && filters.exclude.donors.length > 0) {
      queryFilters.donorId = {
        $nin: filters.exclude.donors,
      };
    }
    if (filters.exclude.objectIds && filters.exclude.objectIds.length > 0) {
      queryFilters.objectId = {
        $nin: filters.exclude.objectIds,
      };
    }
    if (filters.exclude.fileIds && filters.exclude.fileIds.length > 0) {
      queryFilters.fileId = {
        $nin: filters.exclude.fileIds.map(fileIdFromString),
      };
    }
  }
  return queryFilters;
}
