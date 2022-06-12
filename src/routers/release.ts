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
import { omit } from 'lodash';

import { AppConfig } from '../config';
import Logger from '../logger';
import wrapAsync from '../utils/wrapAsync';
import { Release } from '../data/releases';
import * as releaseDataService from '../data/releases';
import { File } from '../data/files';
import * as fileService from '../data/files';
import { calculateRelease, buildActiveRelease, publishActiveRelease } from '../services/release';
const logger = Logger('Release.Router');
/**
 * Check for an existing ACTIVE release, and confirm that the provided version string matches.
 * @param version
 * @returns data object with result of validation check
 */
async function validateActiveReleaseVersion(
  version: string,
): Promise<{ success: boolean; error?: string }> {
  const release = await releaseDataService.getActiveRelease();
  if (!release) {
    return { success: false, error: `No Active Release. Calculate a new release and try again.` };
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
      const releases = await releaseDataService.getReleases();
      const output = releases.map(getShortReleaseResponse);
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
      const release = await releaseDataService.getActiveRelease();
      const output = release ? await getReleaseResponse(release) : {};
      return res.status(200).json(output);
    }),
  );

  /**
   * Get Latest Release
   * Shows without calculation the latest release. This will be either the active release or the last published release.
   * Returns empty object if there has never been a release created.
   */
  router.get(
    '/latest',
    authFilters.read,
    wrapAsync(async (req, res) => {
      const release = await releaseDataService.getLatestRelease();
      const output = release ? await getReleaseResponse(release) : {};
      return res.status(200).json(output);
    }),
  );

  /**
   * Calculate Release
   * Attempt to initiate calculation then return confirmation of state change.
   * Calculation needs to:
   * Find the files that are queued for release and record their IDs
   * Provide a report with a summary of what is in the release and what will be added
   */
  router.post(
    '/calculate',
    authFilters.write,
    wrapAsync(async (req, res) => {
      logger.info(`Attempting to begin calculating release...`);
      const {
        release,
        previousState,
        message,
        updated,
      } = await releaseDataService.beginCalculatingActiveRelease();
      if (updated) {
        logger.info(`Release set to calculating...`);
        const releaseSummary = getShortReleaseResponse(release);
        res.status(200).json({ message, previousState, release: releaseSummary });

        // The work to be done:
        calculateRelease();
      } else {
        logger.warn(`Unable to calculate release: ${message}`);
        res.status(400).json({ error: message });
      }
    }),
  );

  /**
   * Build Release
   * Attempt to initiate build process then return confirmation of state change
   * Build process will:
   * Create new public release indices for each program.
   * TODO: update files that are already public
   * Save snapshot of release.
   * Does not attach new indices to file centric alias, that is done by Publish.
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
      const validationResult = await validateActiveReleaseVersion(version);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error });
      }

      logger.info(`Attempting to begin building release...`);
      const {
        release,
        previousState,
        message,
        updated,
      } = await releaseDataService.beginBuildingActiveRelease();
      if (updated) {
        logger.info(`Release set to building...`);
        const releaseSummary = await getShortReleaseResponse(release);
        res.status(200).json({ message, previousState, release: releaseSummary });

        // The work to be done:
        buildActiveRelease(label);
      } else {
        logger.warn(`Unable to build release: ${message}`);
        res.status(400).json({ error: message });
      }
    }),
  );

  /**
   * Publish Release
   * For files added to public, remove from restricted indices
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
      const validationResult = await validateActiveReleaseVersion(version);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error });
      }

      logger.info(`Attempting to begin publishing release...`);
      const {
        release,
        previousState,
        message,
        updated,
      } = await releaseDataService.beginPublishingActiveRelease();
      if (updated) {
        logger.info(`Release set to publishing...`);
        const releaseSummary = await getShortReleaseResponse(release);
        res.status(200).json({ message, previousState, release: releaseSummary });

        // The work to be done:
        publishActiveRelease();
      } else {
        logger.warn(`Unable to publish release: ${message}`);
        res.status(400).json({ error: message });
      }
    }),
  );

  /**
   * Get Releases
   * Provides list of releases stored in DB, includes:
   *  - their status
   *  - creation and publish date
   *  - release count summary (files, analyses, donors per program)
   *
   * NOTE: Must be added to the router LAST so that all the other paths don't get swallowed by the :id parameter.
   */
  router.get(
    '/:id',
    authFilters.read,
    wrapAsync(async (req, res) => {
      const { id } = req.params;
      const release = await releaseDataService.getReleaseById(id);
      if (!release) {
        return res.status(404).send();
      }
      const output = await getReleaseResponse(release);
      return res.status(200).json(output);
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

/**
 * ShortReleaseSummary is a concise recap of a release, used in the GET / (list of releases) endpoint
 * it shows limited details of a release. Lists of files are reduced to number of files.
 */
type ShortReleaseSummary = {
  id: string;
  state: string;
  error?: string;
  version?: string;
  label?: string;
  calculatedAt?: Date;
  builtAt?: Date;
  publishedAt?: Date;
  files: ReleaseCounts;
};
function getShortReleaseResponse(release: Release): ShortReleaseSummary {
  /**
   * TODO: simplify this with omit - dont want to change too much at once, but we can do this
   *
   * return {...omit(release, ['_id', 'filesKept', 'filesAdded', 'filesRemoved']), id: release._id, files: {file stuff}}
   */
  return {
    id: release._id,
    state: release.state,
    error: release.error,
    version: release.version,
    label: release.label,
    calculatedAt: release.calculatedAt,
    builtAt: release.builtAt,
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
 * Shows the expanded release counts by program and donor.
 * Used for all responses that return a single release.
 */
interface ProgramDetails {
  program: string;
  files: ReleaseCounts;
  donors: ReleaseCounts;
}
type ReleaseSummary = {
  id: string;
  state: string;
  version?: string;
  label?: string;
  snapshot?: string;
  calculatedAt?: Date;
  builtAt?: Date;
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
  type ReleaseCounts = { kept: File[]; added: File[]; removed: File[] };
  type ProgramAccumulator = Record<string, ReleaseCounts>;
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
async function getReleaseResponse(release: Release): Promise<ReleaseSummary> {
  // We need to get the donor and program details of our files
  const filesKept: File[] = await fileService.getFilesByObjectIds(release.filesKept);
  const filesAdded: File[] = await fileService.getFilesByObjectIds(release.filesAdded);
  const filesRemoved: File[] = await fileService.getFilesByObjectIds(release.filesRemoved);

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
  const details: ReleaseSummary = {
    id: release._id,
    ...omit(release, ['_id', 'filesKept', 'filesAdded', 'filesRemoved']),
    totals,
    programs,
  };
  return details;
}
