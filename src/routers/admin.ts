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

import querystring from 'querystring';

import logger from '../logger';
import wrapAsync from '../utils/wrapAsync';
import StringMap from '../utils/StringMap';
import { AppConfig } from '../config';
import validator from './common/validator';
import * as fileService from '../data/files';

import { reindexDataCenter } from '../services/syncDataProcessor';
import { recalculateFileState } from '../services/fileManager';
import { getIndexer } from '../services/indexer';

function fileSummaryResponse(files: fileService.File[]) {
  const total = files.length;
  const ids = files.map(file => file.objectId);
  return { total, ids };
}

const createAdminRouter = (config: AppConfig, authFilter: (scopes: string[]) => RequestHandler) => {
  const router = Router();

  // Ensure all routes in this router are restricted to those with WRITE scope only.
  router.use(authFilter([config.auth.writeScope]));

  /**
   * Request to re-index all analyses from a datacenter.
   */
  router.post(
    '/index/:datacenter',
    wrapAsync(async (req: Request, res: Response) => {
      // const dataCenterId = req.params.datacenter;
      // TODO: Current config hardcodes a single data center instead of retrieving connection details from data center registry

      const studies: string[] = (req.query.study || []) as string[];

      const dataCenterId = config.datacenter.dataCenterId;
      reindexDataCenter(dataCenterId, studies);
      return res.status(200).send(`submitted`);
    }),
  );

  /**
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
          const selectedFiles = await fileService.getFiles(filter);
          const fileSummary = fileSummaryResponse(selectedFiles);
          const response = { message: 'DRY RUN ONLY - No changes made.', ...fileSummary };
          return res.status(200).json(response);
        }

        try {
          const indexer = await getIndexer();

          // Update files in DB
          const updatedFiles = await fileService.adminPromote(filter, stage, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            return res.status(400).send(`No files updated.`);
          }
          const errors: StringMap<Error> = {};

          // Update file indices with changes
          const { results } = await PromisePool.withConcurrency(20)
            .for(updatedFiles)
            .handleError((e, file) => {
              logger.error(`Update Doc Error: ${e}`);
              logger.error(`Update Doc Error: ${e.stack}`);
              errors[file.objectId] = e;
            })
            .process(async file => {
              logger.debug(`Recalculating and reindexing file: ${file.objectId}`);
              const recalculatedFile = await recalculateFileState(file);
              await indexer.updateFile(recalculatedFile);
              return file;
            });

          await indexer.release();

          const fileSummary = fileSummaryResponse(results);
          const response = {
            message: `Successfully updated and re-indexed ${fileSummary.total} files. adminPromote value set to ${stage}`,
            ...fileSummary,
            errors,
          };
          return res.status(200).json(response);
        } catch (e) {
          return res.status(500).send(`Unexpected error updating files: ${e}`);
        }

        return res.status(200).json(filter);
      } catch (error) {
        // Catch Param Validation Errors
        return res.status(400).send(error.toString());
      }
    }),
  );

  /**
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
          const selectedFiles = await fileService.getFiles(filter);
          const fileSummary = fileSummaryResponse(selectedFiles);
          const response = { message: 'DRY RUN ONLY - No changes made.', ...fileSummary };
          return res.status(200).json(response);
        }

        try {
          const indexer = await getIndexer();

          // Update files in DB
          const updatedFiles = await fileService.adminDemote(filter, stage, {
            returnDocuments: true,
          });

          if (!updatedFiles) {
            return res.status(400).send(`No files updated.`);
          }
          const errors: StringMap<Error> = {};

          // Update file indices with changes
          const { results } = await PromisePool.withConcurrency(20)
            .for(updatedFiles)
            .handleError((e, file) => {
              logger.error(`Update Doc Error: ${e}`);
              logger.error(`Update Doc Error: ${e.stack}`);
              errors[file.objectId] = e;
            })
            .process(async file => {
              logger.debug(`Recalculating and reindexing file: ${file.objectId}`);
              const recalculatedFile = await recalculateFileState(file);
              await indexer.updateFile(recalculatedFile);
              return file;
            });

          await indexer.release();

          const fileSummary = fileSummaryResponse(results);
          const response = {
            message: `Successfully updated and re-indexed ${fileSummary.total} files. adminDemote value set to ${stage}`,
            ...fileSummary,
            errors,
          };
          return res.status(200).json(response);
        } catch (e) {
          return res.status(500).send(`Unexpected error updating files: ${e}`);
        }

        return res.status(200).json(filter);
      } catch (error) {
        // Catch Param Validation Errors
        return res.status(400).send(error.toString());
      }
    }),
  );
  return router;
};

export default createAdminRouter;
