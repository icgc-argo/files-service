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

import { Router, Request, Response, RequestHandler } from 'express';
import PromisePool from '@supercharge/promise-pool';
import Logger, { unknownToString } from '../logger';
import wrapAsync from '../utils/wrapAsync';
import { AppConfig } from '../config';
import validator from './common/validator';
import * as fileService from '../data/files';
import reindexDataCenter from '../jobs/reindexDataCenter';
import { recalculateFileState } from '../services/fileManager';
import { getIndexer } from '../services/indexer';

const logger = Logger('Admin.Router');

type UpdateFileSummary = {
  total: number;
  ids: string[];
};
function fileSummaryResponse(files: fileService.File[]): UpdateFileSummary {
  const total = files.length;
  const ids = files.map(file => file.objectId);
  return { total, ids };
}

const createAdminRouter = (config: AppConfig, authFilter: (scopes: string[]) => RequestHandler) => {
  const router = Router();

  // Ensure all routes in this router are restricted to those with WRITE scope only.
  router.use(authFilter([config.auth.writeScope]));

  /**
   * /index/:datacenter
   * Request to re-index all analyses from a datacenter.
   */
  router.post(
    '/index/:datacenter',
    wrapAsync(async (req: Request, res: Response) => {
      // const dataCenterId = req.params.datacenter;
      // TODO: Current config hardcodes a single data center instead of retrieving connection details from data center registry

      // Swagger UI isn't sending single studies as an array, so we need to parse it
      const studies: string[] = ((typeof req.query.study === 'string' ? [req.query.study] : req.query.study) ||
        []) as string[];

      const dataCenterId = config.datacenter.dataCenterId;
      reindexDataCenter(dataCenterId, studies);
      res.status(200).send(`submitted`);
      return;
    }),
  );

  /**
   * '/promote/:stage'
   * Add admin promote value to files based on a filter
   */
  router.post(
    '/promote/:stage',
    wrapAsync(async (req: Request, res: Response) => {
      // Get Params:
      try {
        const filter = validator.fileFilter(req.body);
        const stage = validator.embargoStage(req.params.stage);

        const dryRun = req.query.dryRun === 'true';

        if (dryRun) {
          res.status(200).json(await dryRunFileFilter(filter));
          return;
        }

        try {
          // Update files in DB
          const updatedFiles = await fileService.adminPromote(filter, stage, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            res.status(400).send(`No files updated.`);
            return;
          }

          const result = await indexUpdatedFiles(updatedFiles);

          const response = {
            message: `Successfully updated ${result.fileSummary.total} file(s). adminPromote value set to ${stage}`,
            ...result.fileSummary,
            errors: result.errors,
          };
          res.status(200).json(response);
          return;
        } catch (e) {
          res.status(500).send(`Unexpected error updating files: ${e}`);
          return;
        }
      } catch (error) {
        // Catch Param Validation Errors
        res.status(400).send({ error: unknownToString(error) });
        return;
      }
    }),
  );

  /**
   * '/demote/:stage'
   * Add admin restrict value to files based on a filter
   */
  router.post(
    '/demote/:stage',
    wrapAsync(async (req: Request, res: Response) => {
      // Get Params:
      try {
        const filter = validator.fileFilter(req.body);
        const stage = validator.embargoStage(req.params.stage);

        const dryRun = req.query.dryRun === 'true';

        if (dryRun) {
          res.status(200).json(await dryRunFileFilter(filter));
          return;
        }

        try {
          // Update files in DB
          const updatedFiles = await fileService.adminDemote(filter, stage, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            res.status(400).send(`No files updated.`);
            return;
          }

          const result = await indexUpdatedFiles(updatedFiles);

          const response = {
            message: `Successfully updated ${result.fileSummary.total} file(s). adminDemote value set to ${stage}`,
            ...result.fileSummary,
            errors: result.errors,
          };
          res.status(200).json(response);
          return;
        } catch (e) {
          res.status(500).send(`Unexpected error updating files: ${e}`);
          return;
        }
      } catch (error) {
        // Catch Param Validation Errors
        res.status(400).send({ error: unknownToString(error) });
        return;
      }
    }),
  );

  /**
   * '/clinicalExemption/remove'
   * Remove clinical exemption from files
   */
  router.post(
    '/clinicalExemption/remove',
    wrapAsync(async (req: Request, res: Response) => {
      // Get Params:
      try {
        const filter = validator.fileFilter(req.body);

        const dryRun = req.query.dryRun === 'true';

        if (dryRun) {
          res.status(200).json(await dryRunFileFilter(filter));
          return;
        }

        try {
          // Update files in DB
          const updatedFiles = await fileService.removeClinicalExemption(filter, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            res.status(400).send(`No files updated.`);
            return;
          }

          const result = await indexUpdatedFiles(updatedFiles);

          const response = {
            message: `Successfully updated ${result.fileSummary.total} file(s), removing any clinical exemptions.`,
            ...result.fileSummary,
            errors: result.errors,
          };
          res.status(200).json(response);
          return;
        } catch (e) {
          res.status(500).send(`Unexpected error updating files: ${e}`);
          return;
        }
      } catch (error) {
        // Catch Param Validation Errors
        res.status(400).send({ error: unknownToString(error) });
        return;
      }
    }),
  );

  /**
   * '/clinicalExemption/:reason'
   * Apply a clinical exemption to a selection of files
   * Files with a clinical exemption do not require core complete clincial data to be released to the index
   */
  router.post(
    '/clinicalExemption/:reason',
    wrapAsync(async (req: Request, res: Response) => {
      // Get Params:
      try {
        const filter = validator.fileFilter(req.body);
        const reason = validator.clinicalExemption(req.params.reason);

        const dryRun = req.query.dryRun === 'true';

        if (dryRun) {
          res.status(200).json(await dryRunFileFilter(filter));
          return;
        }

        try {
          // Update files in DB
          const updatedFiles = await fileService.applyClinicalExemption(filter, reason, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            res.status(400).send(`No files updated.`);
            return;
          }
          const result = await indexUpdatedFiles(updatedFiles);

          const response = {
            message: `Successfully updated ${result.fileSummary.total} file(s) with clinical exemption: ${reason}.`,
            reason,
            ...result.fileSummary,
            errors: result.errors,
          };
          res.status(200).json(response);
          return;
        } catch (e) {
          res.status(500).send(`Unexpected error updating files: ${e}`);
          return;
        }
      } catch (error) {
        // Catch Param Validation Errors
        res.status(400).send({ error: unknownToString(error) });
        return;
      }
    }),
  );

  return router;
};

async function dryRunFileFilter(filter: fileService.FileFilter) {
  const selectedFiles = await fileService.getFiles(filter);
  const fileSummary = fileSummaryResponse(selectedFiles);

  return { message: 'DRY RUN ONLY - No changes made.', ...fileSummary };
}

async function indexUpdatedFiles(updatedFiles: fileService.File[]) {
  const errors: Record<string, Error> = {};
  const indexer = await getIndexer();
  // Update file indices with changes
  const { results } = await PromisePool.withConcurrency(20)
    .for(updatedFiles)
    .handleError((e, file) => {
      logger.error(`Update Doc Error: ${e}`);
      logger.error(`Update Doc Error: ${e.stack}`);
      errors[file.objectId] = e;
    })
    .process(async file => {
      logger.debug(`Recalculating and reindexing file: ${file.fileId}`);
      const recalculatedFile = await recalculateFileState(file);
      await indexer.updateRestrictedFile(recalculatedFile);
      return file;
    });

  await indexer.release();

  const fileSummary = fileSummaryResponse(results);

  return { fileSummary, errors };
}

export default createAdminRouter;
