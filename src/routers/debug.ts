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

import { AppConfig } from '../config';

import Logger from '../logger';
import wrapAsync from '../utils/wrapAsync';
import analysisEventHandler from '../services/analysisEventHandler';
import * as fileService from '../data/files';
const logger = Logger('Debug.Router');

const createDebugRouter = (
  config: AppConfig,
  authFilter: (scopes: string[]) => RequestHandler,
): Router => {
  // Middleware to disable debug endpoints based on config
  const testEndpointFilter = (req: Request, res: Response, next: NextFunction) => {
    if (!config.debug.endpointsEnabled) {
      logger.warn(`DEBUG endpoints are disabled. ${req.url} denied.`);
      return res.status(403).send('DEBUG endpoints are disabled.');
    }
    logger.warn(`DEBUG endpoints are enabled. ${req.method} ${req.url} requested.`);
    return next();
  };

  const router = Router();

  router.use(testEndpointFilter);

  router.delete(
    '/files',
    authFilter([config.auth.writeScope]),
    wrapAsync(async (req: Request, res: Response) => {
      const ids = (req.query.id as string | undefined)?.split(',') || [];
      await fileService.deleteAll(ids);
      return res.status(201).send();
    }),
  );

  router.post(
    '/handleAnalysisEvent',
    authFilter([config.auth.writeScope]),
    wrapAsync(async (req: Request, res: Response) => {
      const analysisEvent = req.body;
      const result = await analysisEventHandler(analysisEvent);
      return res.status(201).send(result);
    }),
  );

  return router;
};

export default createDebugRouter;
