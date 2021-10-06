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

import { AppConfig, getAppConfig } from '../config';
import mongoose from 'mongoose';
import Logger from '../logger';
import Status from '../types/Status';
const logger = Logger('DBConnection');

export const connectDb = async (appConfig: AppConfig) => {
  /** Mongoose setup */
  mongoose.connection.on('connecting', () => {
    logger.info('Connecting to MongoDB...');
    setDBStatus(Status.OK);
  });
  mongoose.connection.on('connected', () => {
    logger.info('...Connection Established to MongoDB');
    setDBStatus(Status.OK);
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('Connection Reestablished');
    setDBStatus(Status.OK);
  });
  mongoose.connection.on('disconnected', (args: any[]) => {
    logger.warn('Connection Disconnected ' + JSON.stringify(args));
    setDBStatus(Status.ERROR);
  });
  mongoose.connection.on('close', () => {
    logger.warn('Connection Closed');
    setDBStatus(Status.ERROR);
  });
  mongoose.connection.on('error', error => {
    logger.error('MongoDB Connection Error:' + error);
    setDBStatus(Status.ERROR);
  });
  mongoose.connection.on('reconnectFailed', () => {
    logger.error('Ran out of reconnect attempts, abandoning...');
    setDBStatus(Status.ERROR);
  });

  try {
    await mongoose.connect(appConfig.mongoProperties.dbUrl, {
      autoReconnect: true,
      connectTimeoutMS: 3000,
      keepAlive: true,
      reconnectTries: 3,
      reconnectInterval: 3000,
      useNewUrlParser: true,
      user: appConfig.mongoProperties.dbUsername,
      pass: appConfig.mongoProperties.dbPassword,
      w: appConfig.mongoProperties.writeConcern,
      wtimeout: appConfig.mongoProperties.writeAckTimeout,
    });
  } catch (err) {
    logger.error('MongoDB connection error. Please make sure MongoDB is running. ' + err);
    process.exit();
  }
};

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
