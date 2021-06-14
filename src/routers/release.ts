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
import { Router, RequestHandler } from 'express';

import { AppConfig } from '../config';
import logger from '../logger';
import wrapAsync from '../utils/wrapAsync';
import StringMap from '../utils/StringMap';
import { Release } from '../data/releases';
import * as releaseService from '../data/releases';
import { File } from '../data/files';
import * as fileService from '../data/files';
import { calculateRelease, buildActiveRelease, publishActiveRelease } from '../services/release';

/**
 * Check for an existing ACTIVE release, and confirm that the provided version string matches.
 * @param version
 * @returns data object with result of validation check
 */
async function validateActiveAuthVersion(
  version: string,
): Promise<{ success: boolean; error?: string }> {
  const release = await releaseService.getActiveRelease();
  if (!release) {
    return { success: false, error: `No Active Release. Calculate the release and try again.` };
  }
  if (version !== release.version) {
    return {
      success: false,
      error: `Active release's version does not match the provided version.`,
    };
  }
  return { success: true };
}

const createReleaseRouter = (
  config: AppConfig,
  authFilter: (scopes: string[]) => RequestHandler,
) => {
  const router = Router();

  const authFilters = {
    read: authFilter([config.auth.readScope, config.auth.writeScope]),
    write: authFilter([config.auth.writeScope]),
  };

  /**
   * Get Releases
   * Provides list of releases stored in DB, includes:
   *  - their status
   *  - creation and publish date
   *  - release count summary (files, analyses, donors per program)
   */
  router.get(
    '/',
    authFilters.read,
    wrapAsync(async (req, res) => {
      const releases = await releaseService.getReleases();
      const output = releases.map(summarizeRelease);
      return res.status(200).json(output);
    }),
  );

  /**
   * Get Active Release
   * Shows without calculation the information in the current release
   */
  router.get(
    '/active',
    authFilters.read,
    wrapAsync(async (req, res) => {
      const release = await releaseService.getActiveRelease();
      const output = release ? await getReleaseDetails(release) : {};
      return res.status(200).json(output);
    }),
  );

  /**
   * Calculate Release
   * Find the files that are queued for release and record their IDs
   * Provide a report with a summary of what is in the release and what will be added
   */
  router.post(
    '/calculate',
    authFilters.write,
    wrapAsync(async (req, res) => {
      const release = await calculateRelease();
      const output = await getReleaseDetails(release);
      return res.status(200).json(output);
    }),
  );

  /**
   * Build Release
   * Create new public release indices for each program. Does not attach to alias, that is done by Publish.
   */
  router.post(
    '/build/:version/:label',
    authFilters.write,
    wrapAsync(async (req, res) => {
      const { version, label } = req.params;
      if (!version) {
        return res.status(400).json({ error: `Missing path parameter: version` });
      }
      if (!label) {
        return res.status(400).json({ error: `Missing path parameter: label` });
      }
      const validationResult = await validateActiveAuthVersion(version);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error });
      }

      const builtRelease = await buildActiveRelease(label);

      return res.status(200).json(builtRelease);
    }),
  );

  /**
   * Publish Release
   * Attach built public indices to the file centric alias
   */
  router.post(
    '/publish/:version',
    authFilters.write,
    wrapAsync(async (req, res) => {
      const { version } = req.params;
      if (!version) {
        return res.status(400).json({ error: `Missing path parameter: version` });
      }
      const validationResult = await validateActiveAuthVersion(version);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error });
      }

      const publishedRelease = await publishActiveRelease();

      return res.status(200).json(publishedRelease);
    }),
  );
  return router;
};

export default createReleaseRouter;

/**
 * Request and Response Types:
 */
type ReleaseCounts = {
  kept: number;
  added: number;
  removed: number;
};

// Release Summary is the short version,
//  it shows limited details of a release. Lists of files are reduced to number of files.
type ReleaseSummary = {
  id: string;
  state: string;
  version: string;
  label?: string;
  calculatedAt: Date;
  publishedAt?: Date;
  files: ReleaseCounts;
};
function summarizeRelease(release: Release): ReleaseSummary {
  return {
    id: release._id,
    state: release.state,
    version: release.version,
    label: release.version,
    calculatedAt: release.calculatedAt,
    publishedAt: release.publishedAt,
    files: {
      kept: release.filesKept.length,
      added: release.filesAdded.length,
      removed: release.filesRemoved.length,
    },
  };
}

/**
 * Release Details
 * Shows the expanded release counts by program and donor
 */
interface ProgramDetails {
  program: string;
  files: ReleaseCounts;
  donors: ReleaseCounts;
}
type ReleaseDetails = {
  id: string;
  state: string;
  version: string;
  label?: string;
  calculatedAt: Date;
  publishedAt?: Date;
  programs: ProgramDetails[];
  totals: { files: ReleaseCounts; donors: ReleaseCounts };
};
function countDonors(files: File[]): number {
  const donors = new Set<string>();
  files.forEach(file => donors.add(file.donorId));
  return donors.size;
}
function summarizePrograms(kept: File[], added: File[], removed: File[]) {
  /**
   * Reducer to accumulate all the files sorted by program
   */
  type ProgramAccumulator = StringMap<{ kept: File[]; added: File[]; removed: File[] }>;
  const programAccumulator: ProgramAccumulator = {};

  // Create a reducer for the kept, added, or removed list
  const programSortReducer = (key: 'kept' | 'added' | 'removed') => (
    accumulator: ProgramAccumulator,
    file: File,
  ): ProgramAccumulator => {
    const program = file.programId;
    if (!accumulator[program]) {
      accumulator[program] = { kept: [], added: [], removed: [] };
    }
    accumulator[program][key].push(file);
    return accumulator;
  };

  kept.reduce(programSortReducer('kept'), programAccumulator);
  added.reduce(programSortReducer('added'), programAccumulator);
  removed.reduce(programSortReducer('removed'), programAccumulator);

  /**
   * Now format the data for use in the expanded release details
   */
  const output: ProgramDetails[] = [];
  for (const program in programAccumulator) {
    const { kept, added, removed } = programAccumulator[program];
    const files: ReleaseCounts = {
      kept: kept.length,
      added: added.length,
      removed: removed.length,
    };
    const donors: ReleaseCounts = {
      kept: countDonors(kept),
      added: countDonors(added),
      removed: countDonors(removed),
    };
    const details: ProgramDetails = { program, files, donors };
    output.push(details);
  }
  return output;
}

async function getReleaseDetails(release: Release): Promise<ReleaseDetails> {
  const { state, version, label, calculatedAt, publishedAt } = release;

  // We need to get the donor and program details of our files
  const filesKept: File[] = await fileService.getFilesFromObjectIds(release.filesKept);
  const filesAdded: File[] = await fileService.getFilesFromObjectIds(release.filesAdded);
  const filesRemoved: File[] = await fileService.getFilesFromObjectIds(release.filesRemoved);

  const totals = {
    files: {
      kept: filesKept.length,
      added: filesAdded.length,
      removed: filesRemoved.length,
    },
    donors: {
      kept: countDonors(filesKept),
      added: countDonors(filesAdded),
      removed: countDonors(filesRemoved),
    },
  };
  const programs = summarizePrograms(filesKept, filesAdded, filesRemoved);
  const details: ReleaseDetails = {
    id: release._id,
    state,
    version,
    calculatedAt,
    totals,
    programs,
  };
  if (label) {
    details.label = label;
  }
  if (publishedAt) {
    details.publishedAt = publishedAt;
  }
  return details;
}
