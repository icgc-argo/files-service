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

import App from './app';
import mongoose from 'mongoose';
import Logger from './logger';
import { Server } from 'http';
import { getAppConfig } from './config';
import { database, up } from 'migrate-mongo';
import { Consumer, Producer } from 'kafkajs';
import * as kafka from './external/kafka';
import { getClient } from './external/elasticsearch';
import * as dbConnection from './data/dbConnection';

const serverLog = Logger('Server');
const mongoLog = Logger('Mongo');

let server: Server;
let kafkaConnections: Promise<{
  analysisUpdatesConsumer: Consumer | undefined;
  analysisUpdatesDlqProducer: Producer | undefined;
}>;

// bootstraping the app and setting up connections to: db, kafka, experss server
(async () => {
  const appConfig = await getAppConfig();

  if (process.env.LOG_QUERIES === 'true') {
    mongoose.set('debug', true);
  }
  /**
   * Migrate mongo config requires exact undefined to be able to connect to db without user/password (dev/qa) env
   * if the value is undefined or empty string we have to avoid setting it in the env because process.env will force string "undefined"
   */
  const mongoProps = appConfig.mongoProperties;
  if (mongoProps.dbUsername && mongoProps.dbPassword) {
    process.env.DB_USERNAME = mongoProps.dbUsername;
    process.env.DB_PASSWORD = mongoProps.dbPassword;
  }

  let connection: any;
  try {
    connection = await database.connect();
    const migrated = await up(connection.db);
    migrated.forEach((fileName: string) => mongoLog.info('Migrated:', fileName));
  } catch (err) {
    mongoLog.error('failed to do migration', err);
    process.exit(-10);
  }

  await dbConnection.connectDb(appConfig);

  /**
   * Start Express server.
   */
  const app = App(appConfig);
  server = app.listen(app.get('port'), () => {
    serverLog.info(
      `Server started in ${app.get('env')} mode`,
      `Listening to port ${app.get('port')}`,
    );
    if (!appConfig.auth.enabled) {
      serverLog.warn(`Application running with AUTH DISABLED!`);
    }
    // serverLog.warn
    serverLog.debug(`Access Swagger Docs at http://localhost:${app.get('port')}/api-docs`);
    serverLog.debug('Press CTRL-C to stop');
  });

  if (appConfig.kafkaProperties.kafkaMessagingEnabled) {
    kafkaConnections = kafka.setup(appConfig);
  }

  // Init ES client
  const esClient = getClient();
})();

// terminate kafka connections before exiting
// https://kafka.js.org/docs/producer-example
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.map(type => {
  process.on(type as any, async (e: Error) => {
    try {
      mongoLog.info(`process.on ${type}`);
      mongoLog.error(e.message);
      console.log(e); // Get full error output
      await mongoose.disconnect();
      if (kafkaConnections) {
        const kc = await kafkaConnections;
        await Promise.all([
          kc.analysisUpdatesConsumer?.disconnect(),
          kc.analysisUpdatesDlqProducer?.disconnect(),
        ]);
      }
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.map(type => {
  process.once(type as any, async () => {
    try {
      await mongoose.disconnect();
      if (kafkaConnections) {
        const kc = await kafkaConnections;
        await Promise.all([
          kc.analysisUpdatesConsumer?.disconnect(),
          kc.analysisUpdatesDlqProducer?.disconnect(),
        ]);
      }
    } finally {
      process.kill(process.pid, type);
    }
  });
});
