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

import mongoose, { PaginateModel } from 'mongoose';
import { File } from 'winston/lib/winston/transports';
import { FILE_PAGE_SIZE_LIMIT } from '../../config';

// Main reason for using this pagination plugin
// is that it provides flexibility on pagination options such as
// select, sort, offset, page, limit  ect.. It's easy to code with and
// the return value gives extra info such prevPage, nextPage, totalDocs.
import mongoosePaginate from 'mongoose-paginate-v2';
import { isEmpty } from 'lodash';

const AutoIncrement = require('mongoose-sequence')(mongoose);

export enum EmbargoStage {
  PROGRAM_ONLY = 'PROGRAM_ONLY',
  MEMBER_ACCESS = 'MEMBER_ACCESS',
  ASSOCIATE_ACCESS = 'ASSOCIATE_ACCESS',
  PUBLIC = 'PUBLIC',
}

/**
 * A file with a clinical exemption can be released to the file index even if it fails to pass the clinical data requirements.
 * The enum values indicate the reason the file was given the exemption:
 * - LEGACY: This file was publicly available in the Legacy ICGC system so does not need to pass through the embargo stages.
 * - EARLY_RELEASE: This file was published publicly in ARGO before the clinical embargo requirements were enforced.
 * - ADMIN: DCC Admin has made the decision to make this file publicly available without requiring clinical data.
 */
export enum ClinicalExemption {
  LEGACY = 'LEGACY',
  EARLY_RELEASE = 'EARLY_RELEASE',
  ADMIN = 'ADMIN',
}

export enum FileReleaseState {
  RESTRICTED = 'RESTRICTED',
  QUEUED_TO_PUBLIC = 'QUEUED',
  PUBLIC = 'PUBLIC',
  QUEUED_TO_RESTRICT = 'QUEUED_TO_RESTRICT',
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

// DbFile has the types we get back out of the DB (before casting strings to enums)
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

  adminHold?: boolean;
  adminPromote?: string;
  adminDemote?: string;

  clinicalExemption?: string;

  labels: FileLabel[];
}

// File is the POJO with proper types for a document read from the DB
export interface File {
  fileId: string;
  fileNumber: number;
  objectId: string;
  repoId: string;
  status: string;

  programId: string;
  donorId: string;
  analysisId: string;
  firstPublished?: Date;

  embargoStage: EmbargoStage;
  releaseState: FileReleaseState;

  adminHold?: boolean;
  adminPromote?: EmbargoStage;
  adminDemote?: EmbargoStage;

  clinicalExemption?: ClinicalExemption;

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

  adminHold?: boolean;
  adminPromote?: EmbargoStage;
  adminDemote?: EmbargoStage;

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
    adminDemote: {
      type: String,
      required: false,
      enum: Object.values(EmbargoStage),
    },
    adminHold: { type: Boolean, required: false },

    clinicalExemption: { type: String, required: false, enum: Object.values(ClinicalExemption) },

    labels: [LabelSchema],
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

export type PaginationFilter = {
  page?: number;
  limit?: number;
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

FileSchema.plugin(mongoosePaginate);

export type FileMongooseDocument = mongoose.Document & DbFile;

export async function countFiles(filters: FileFilter) {
  return (await FileModel.count(convertFiltersForMongoose(filters)).exec()) as number;
}

export async function getFiles(filters: FileFilter) {
  return (await FileModel.find(
    convertFiltersForMongoose(filters),
  ).exec()) as FileMongooseDocument[];
}

export async function getFilesQuery(
  paginationFilters: PaginationFilter,
  filters: FileFilterProperties,
): Promise<mongoose.PaginateResult<FileMongooseDocument>> {
  const paginateOptions = {
    page: paginationFilters.page ? paginationFilters.page : 1,
    limit: paginationFilters.limit ? paginationFilters.limit : FILE_PAGE_SIZE_LIMIT,
    sort: { fileId: 'asc' },
  };

  return await FileModel.paginate(buildQueryFilters(filters), paginateOptions);
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

export function getFilesIterator(filter: FileFilter): AsyncGenerator<FileMongooseDocument> {
  return FileModel.find(convertFiltersForMongoose(filter));
}

export async function getPrograms(filter: FileFilter) {
  return (await FileModel.distinct(
    'programId',
    convertFiltersForMongoose(filter),
  ).exec()) as string[];
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

const FileModel = mongoose.model<FileMongooseDocument>('File', FileSchema) as PaginateModel<
  FileMongooseDocument
>;

function buildQueryFilters(filters: FileFilterProperties, include: boolean = true) {
  const conditions: mongoose.MongooseFilterQuery<FileMongooseDocument>[] = [];
  const filterOperation = include ? '$in' : '$nin';
  if (filters.analyses && filters.analyses.length > 0) {
    conditions.push({
      analysisId: {
        [filterOperation]: filters.analyses,
      },
    });
  }
  if (filters.programs && filters.programs.length > 0) {
    conditions.push({
      programId: {
        [filterOperation]: filters.programs,
      },
    });
  }
  if (filters.objectIds && filters.objectIds.length > 0) {
    conditions.push({
      objectId: {
        [filterOperation]: filters.objectIds,
      },
    });
  }
  if (filters.donors && filters.donors.length > 0) {
    conditions.push({
      donorId: {
        [filterOperation]: filters.donors,
      },
    });
  }
  if (filters.fileIds && filters.fileIds.length > 0) {
    conditions.push({
      fileId: {
        [filterOperation]: filters.fileIds.map(fileIdFromString),
      },
    });
  }
  return conditions.length > 0 ? { $or: conditions } : {};
}
const fileIdFromString = (fileId: string): number => {
  return parseInt(fileId.replace(/^FL/, ''));
};

function convertFiltersForMongoose(filters: FileFilter) {
  const includeConditions = filters.include ? buildQueryFilters(filters.include) : {};
  const excludeConditions = filters.exclude ? buildQueryFilters(filters.exclude, false) : {};
  const combinedConditions = [includeConditions, excludeConditions].filter(x => !isEmpty(x));
  const queryFilters: mongoose.MongooseFilterQuery<FileMongooseDocument> = isEmpty(
    combinedConditions,
  )
    ? {}
    : { $and: combinedConditions };

  return queryFilters;
}
