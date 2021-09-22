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

import { createHash } from 'crypto';

import { FilterQuery } from 'mongodb';
import mongoose from 'mongoose';

/**
 * `CREATED` -> `CALCULATING` -> `CALCULATED` -> `BUILDING` -> `BUILT` -> `PUBLISHING` -> `PUBLISHED`
 */
export enum ReleaseState {
  CREATED = 'CREATED',

  CALCULATING = 'CALCULATING',
  CALCULATED = 'CALCULATED',
  ERROR_CALCULATE = 'ERROR_CALCULATE',

  BUILDING = 'BUILDING',
  BUILT = 'BUILT',
  ERROR_BUILD = 'ERROR_BUILD',

  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  ERROR_PUBLISH = 'ERROR_PUBLISH',
}

export interface Release {
  _id: string;
  version?: string;
  state: ReleaseState;
  error?: string;

  filesKept: string[];
  filesAdded: string[];
  filesRemoved: string[];

  calculatedAt?: Date;
  builtAt?: Date;
  publishedAt?: Date;
  indices: string[];
  label?: string;
  snapshot?: string;
}

interface DbRelease {
  version?: string;
  state: string;
  error?: string;

  filesKept: string[];
  filesAdded: string[];
  filesRemoved: string[];

  calculatedAt?: Date;
  builtAt?: Date;
  publishedAt?: Date;
  indices: string[];
  label?: string;
  snapshot?: string;
}

const ReleaseSchema = new mongoose.Schema(
  {
    version: { type: String, required: false },
    state: {
      type: String,
      required: true,
      enum: Object.values(ReleaseState),
      default: ReleaseState.CREATED,
    },
    error: {
      type: String,
      required: false,
    },

    filesKept: { type: [String], required: true },
    filesAdded: { type: [String], required: true },
    filesRemoved: { type: [String], required: true },

    calculatedAt: { type: Date, required: false },
    builtAt: { type: Date, required: false },
    publishedAt: { type: Date, required: false },
    label: { type: String, required: false, unique: true, trim: true, sparse: true },
    indices: { type: [String], required: true, default: [] },
    snapshot: { type: String, required: false },
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

export type ReleaseMongooseDocument = mongoose.Document & DbRelease;

const ReleaseModel = mongoose.model<ReleaseMongooseDocument>('Release', ReleaseSchema);

export type ReleaseFilesInput = {
  kept: string[];
  added: string[];
  removed: string[];
};

/**
 * null values are used to clear previously set values
 */
export type ReleaseUpdates = {
  files?: ReleaseFilesInput | null;
  label?: string | null;
  indices?: string[] | null;
  calculatedAt?: Date | null;
  builtAt?: Date | null;
  publishedAt?: Date | null;
  state?: ReleaseState;
  error?: string | null;
  snapshot?: string | null;
};

export async function create(): Promise<ReleaseMongooseDocument> {
  const release = new ReleaseModel({
    filesKept: [],
    filesAdded: [],
    filesRemoved: [],
  });
  return await release.save();
}

export async function getRelease(
  filter: FilterQuery<ReleaseMongooseDocument>,
): Promise<ReleaseMongooseDocument | undefined> {
  return await ReleaseModel.findOne(filter);
}

export async function getLatestRelease(): Promise<ReleaseMongooseDocument | undefined> {
  return await ReleaseModel.findOne({}, {}, { sort: { createdAt: -1 } });
}

export async function getReleases(): Promise<ReleaseMongooseDocument[]> {
  return (await ReleaseModel.find({}).exec()) as ReleaseMongooseDocument[];
}

export async function updateRelease(
  release: Release,
  updates: ReleaseUpdates,
): Promise<ReleaseMongooseDocument> {
  // TODO: Clean up this massive unmaintainable section of copy-pasta

  const updatedRelease: Release = {
    ...release,
  };

  // State (no null case)
  if (updates.state) {
    updatedRelease.state = updates.state;
  }

  // Files
  if (updates.files) {
    updatedRelease.filesKept = updates.files.kept;
    updatedRelease.filesAdded = updates.files.added;
    updatedRelease.filesRemoved = updates.files.removed;
    updatedRelease.version = calculateVersion(updates.files);
  }
  if (updates.files === null) {
    updatedRelease.filesKept = [];
    updatedRelease.filesAdded = [];
    updatedRelease.filesRemoved = [];
    updatedRelease.version = undefined;
  }

  // Label
  if (updates.label) {
    updatedRelease.label = updates.label;
  }
  if (updates.label === null) {
    updatedRelease.label = undefined;
  }

  // Snapshot
  if (updates.snapshot) {
    updatedRelease.snapshot = updates.snapshot;
  }
  if (updates.snapshot === null) {
    updatedRelease.snapshot = undefined;
  }

  // Indices (reset to [])
  if (updates.indices) {
    updatedRelease.indices = updates.indices;
  }
  if (updates.indices === null) {
    updatedRelease.indices = [];
  }

  // Calculated At
  if (updates.calculatedAt) {
    updatedRelease.calculatedAt = updates.calculatedAt;
  }
  if (updates.calculatedAt === null) {
    updatedRelease.calculatedAt = undefined;
  }

  // Built At
  if (updates.builtAt) {
    updatedRelease.builtAt = updates.builtAt;
  }
  if (updates.builtAt === null) {
    updatedRelease.builtAt = undefined;
  }

  // Published At
  if (updates.publishedAt) {
    updatedRelease.publishedAt = updates.publishedAt;
  }
  if (updates.publishedAt === null) {
    updatedRelease.publishedAt = undefined;
  }

  // Error
  if (updates.error) {
    updatedRelease.error = updates.error;
  }
  if (updates.error === null) {
    updatedRelease.error = undefined;
  }
  return (await ReleaseModel.findOneAndUpdate({ _id: release._id }, updatedRelease, {
    new: true,
  })) as ReleaseMongooseDocument;
}

function calculateVersion(files: ReleaseFilesInput): string {
  const sortedKept = files.kept.sort();
  const sortedAdded = files.added.sort();
  const sortedRemoved = files.removed.sort();
  const versionInput = sortedKept
    .concat(sortedAdded)
    .concat(sortedRemoved)
    .join('');
  return createHash('md5')
    .update(versionInput)
    .digest('hex');
}
