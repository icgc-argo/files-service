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
import { AppConfig } from '../config';
import wrapAsync from '../utils/wrapAsync';
import * as fileService from '../data/files';
import { Errors } from '../data/files';

const createFilesRouter = (config: AppConfig, authFilter: (scopes: string[]) => RequestHandler) => {
  const router = Router();

  const authFilters = {
    read: authFilter([config.auth.readScope, config.auth.writeScope]),
    write: authFilter([config.auth.writeScope]),
  };

  /**
   * Get stored files using analyusisId, objectId, or programId as provided in query params
   * TODO: May need refactoring to consider pagination or to remove ability to filter only by programId, responses could get huge.
   */
  router.get(
    '/',
    authFilters.read,
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(
        await fileService.getPaginatedFiles(
          {
            page: (req.query as any)?.page,
            limit: (req.query as any)?.limit,
          },
          {
            analyses: (req.query as any)?.analyses?.split(','),
            objectIds: (req.query as any)?.objectIds?.split(','),
            programs: (req.query as any)?.programs?.split(','),
            donors: (req.query as any)?.donors?.split(','),
            fileIds: (req.query as any)?.fileIds?.split(','),
          },
        ),
      );
    }),
  );

  /**
   * Get File record by ID
   */
  router.get(
    '/:id',
    authFilters.read,
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(await fileService.getFileById(req.params.id));
    }),
  );

  /**
   * Update or Create File record
   * TODO - Move to Debug or Admin router - I can't see an automated service registering files directly, plan instead is to follow updates from RDPC through Kafka messages
   */
  router.post(
    '/',
    authFilters.write,
    wrapAsync(async (req: Request, res: Response) => {
      const file = req.body;
      const result = await fileService.getOrCreateFileByObjId(file);
      return res.status(200).send(result);
    }),
  );

  /**
   * Add or update label on a file
   */
  router.patch(
    '/:id/labels',
    authFilters.write,
    wrapAsync(async (req: Request, res: Response) => {
      const labels = req.body as any;
      const id = req.params.id;
      if (!id) {
        throw new Errors.InvalidArgument('id is required');
      }
      await fileService.addOrUpdateFileLabel(id, labels);
      return res.status(200).send();
    }),
  );

  /**
   * Remove list of labels from a File
   */
  router.delete(
    '/:id/labels',
    authFilters.write,
    wrapAsync(async (req: Request, res: Response) => {
      const keys = (req.query?.keys as string)?.split(',');
      if (keys == undefined) {
        throw new Errors.InvalidArgument('keys list are required');
      }
      const id = req.params.id;
      if (!id) {
        throw new Errors.InvalidArgument('id is required');
      }
      await fileService.removeLabel(id, keys);
      return res.status(200).send();
    }),
  );

  return router;
};

export default createFilesRouter;
