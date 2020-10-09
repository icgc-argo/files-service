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

import express, { NextFunction, Request, Response, RequestHandler } from 'express';
import bodyParser from 'body-parser';
import * as swaggerUi from 'swagger-ui-express';
import path from 'path';
import yaml from 'yamljs';
import { Errors, getFileRecordById, getFiles } from './service';
import { AppConfig } from './config';
import { getOrCreateFileRecordByObjId } from './service';
import logger from './logger';
import { File } from './entity';
import Auth from './auth';
import log from './logger';

const App = (config: AppConfig): express.Express => {
  // Auth middleware
  const noOpReqHandler: RequestHandler = (req, res, next) => {
    log.warn('calling protected endpoint without auth enabled');
    next();
  };
  const authFilter = config.auth.enabled
    ? Auth(config.auth.jwtKeyUrl, config.auth.jwtKey)
    : (scope: string) => {
        return noOpReqHandler;
      };

  const app = express();
  app.set('port', process.env.PORT || 3000);
  app.use(bodyParser.json());

  app.get('/', (req, res) => res.status(200).sendFile(__dirname + '/resources/index.html'));

  app.get('/health', (req, res) => {
    const status = dbHealth.status == Status.OK ? 200 : 500;
    const resBody = {
      db: dbHealth,
      version: `${process.env.npm_package_version} - ${process.env.SVC_COMMIT_ID}`,
    };
    return res.status(status).send(resBody);
  });

  app.get(
    '/files',
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(
        await getFiles({
          analysisId: (req.query as any)?.analysisId?.split(','),
          objectId: (req.query as any)?.objectId?.split(','),
          programId: (req.query as any)?.programId?.split(','),
        }),
      );
    }),
  );

  app.get(
    '/files/:id',
    wrapAsync(async (req: Request, res: Response) => {
      return res.status(200).send(await getFileRecordById(Number(req.params.id)));
    }),
  );

  app.post(
    '/files',
    authFilter(config.auth.WRITE_SCOPE),
    wrapAsync(async (req: Request, res: Response) => {
      const file = req.body as File;
      return res.status(200).send(await getOrCreateFileRecordByObjId(file));
    }),
  );

  app.use(
    config.openApiPath,
    swaggerUi.serve,
    swaggerUi.setup(yaml.load(path.join(__dirname, './resources/swagger.yaml'))),
  );

  app.use('/static', express.static(path.join(__dirname, 'resources')));
  // this has to be defined after all routes for it to work
  app.use(errorHandler);

  return app;
};

// general catch all error handler
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): any => {
  logger.error('error handler received error: ', err);
  if (res.headersSent) {
    logger.debug('error handler skipped');
    return next(err);
  }
  let status: number;
  let customizableMsg = err.message;

  switch (true) {
    case err instanceof Errors.InvalidArgument:
      status = 400;
      break;
    case err instanceof Errors.NotFound:
      err.name = 'Not found';
      status = 404;
      break;
    case err instanceof Errors.StateConflict:
      status = 409;
      break;
    case (err as any).name == 'CastError':
      status = 404;
      err.name = 'Not found';
      customizableMsg = 'Id not found';
      break;
    default:
      status = 500;
  }
  res.status(status).send({ error: err.name, message: customizableMsg });
  // pass the error down (so other error handlers can also process the error)
  next(err);
};

// wrapper to handle errors from async express route handlers
export const wrapAsync = (fn: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
      routePromise.catch(next);
    }
  };
};

export enum Status {
  OK = '😇',
  UNKNOWN = '🤔',
  ERROR = '😱',
}

export const dbHealth = {
  status: Status.UNKNOWN,
  stautsText: 'N/A',
};

export function setDBStatus(status: Status) {
  if (status == Status.OK) {
    dbHealth.status = Status.OK;
    dbHealth.stautsText = 'OK';
  }
  if (status == Status.UNKNOWN) {
    dbHealth.status = Status.UNKNOWN;
    dbHealth.stautsText = 'UNKNOWN';
  }
  if (status == Status.ERROR) {
    dbHealth.status = Status.ERROR;
    dbHealth.stautsText = 'ERROR';
  }
}

export default App;
