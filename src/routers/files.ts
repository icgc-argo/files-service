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

import { Router, Request, Response, RequestHandler, NextFunction } from 'express';

import logger from '../logger';
import { AppConfig } from '../config';
import wrapAsync from '../utils/wrapAsync';
import * as service from '../service';
import { Errors } from '../service';
import { File } from '../entity';

const createFilesRouter = (config: AppConfig, authFilter: (scopes: string[]) => RequestHandler) => {
  const router = Router();

  router.get(
    '/',
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(
        await service.getFiles({
          analysisId: (req.query as any)?.analysisId?.split(','),
          objectId: (req.query as any)?.objectId?.split(','),
          programId: (req.query as any)?.programId?.split(','),
        }),
      );
    }),
  );

  router.get(
    '/:id',
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(await service.getFileRecordById(req.params.id));
    }),
  );

  router.post(
    '/',
    authFilter([config.auth.writeScope]),
    wrapAsync(async (req: Request, res: Response) => {
      const file = req.body as File;
      return res.status(200).send(await service.getOrCreateFileRecordByObjId(file));
    }),
  );

  router.patch(
    '/:id/labels',
    authFilter([config.auth.writeScope]),
    wrapAsync(async (req: Request, res: Response) => {
      const labels = req.body as any;
      const id = req.params.id;
      if (!id) {
        throw new Errors.InvalidArgument('id is required');
      }
      await service.addOrUpdateFileLabel(id, labels);
      return res.status(200).send();
    }),
  );

  router.delete(
    '/:id/labels',
    authFilter([config.auth.writeScope]),
    wrapAsync(async (req: Request, res: Response) => {
      const keys = (req.query?.keys as string)?.split(',');
      if (keys == undefined) {
        throw new Errors.InvalidArgument('keys list are required');
      }
      const id = req.params.id;
      if (!id) {
        throw new Errors.InvalidArgument('id is required');
      }
      await service.removeLabel(id, keys);
      return res.status(200).send();
    }),
  );

  return router;
};

export default createFilesRouter;
