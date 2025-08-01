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
import path from 'path';
import * as swaggerUi from 'swagger-ui-express';
import yaml from 'yamljs';
import Auth from '@overture-stack/ego-token-middleware';

import { Errors } from './data/files';
import { AppConfig } from './config';
import Logger from './logger';

import createAdminRouter from './routers/admin';
import createFilesRouter from './routers/files';
import HealthRouter from './routers/health';
import createDebugRouter from './routers/debug';
import createReleaseRouter from './routers/release';
import createDonorCentricRouter from './routers/donorCentric';

const App = (config: AppConfig): express.Express => {
	// Auth middleware
	const authFilter = config.auth.enabled
		? Auth(config.auth.jwtKeyUrl, config.auth.jwtKey)
		: (scopes: string[]) => {
				return noOpReqHandler;
		  };

	const app = express();
	app.set('port', process.env.PORT || 3000);
	app.use(express.json());

	// Cool matrix background for homepage:
	// app.get('/', (req, res) => res.status(200).sendFile(__dirname + '/resources/index.html'));
	app.get('/', HealthRouter);

	app.use('/health', HealthRouter);
	app.use('/admin', createAdminRouter(config, authFilter));
	app.use('/files', createFilesRouter(config, authFilter));
	app.use('/debug', createDebugRouter(config, authFilter));
	app.use('/release', createReleaseRouter(config, authFilter));
	app.use('/donor-centric', createDonorCentricRouter(config, authFilter));

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
	const logger = Logger('GlobalErrorHandler');
	logger.error('Received unhandled error: ', err);
	if (res.headersSent) {
		logger.debug('Skipping error processing, response headers already sent.');
		return next(err);
	}
	let status: number;
	let customizableMsg = err.message;

	switch (true) {
		case err.name == 'Unauthorized':
			status = 401;
			break;
		case err.name == 'Forbidden':
			status = 403;
			break;
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

const noOpReqHandler: RequestHandler = (req, res, next) => {
	const logger = Logger('App');
	logger.warn(`Accepting request to ( ${req.url} ) endpoint without auth enabled.`);
	next();
};

export default App;
