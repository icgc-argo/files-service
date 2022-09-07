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

import { createLogger, LoggerOptions, transports, format } from 'winston';

const { combine, timestamp, colorize, printf } = format;
const options: LoggerOptions = {
  format: combine(
    colorize(),
    timestamp(),
    printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
  ),
  transports: [
    new transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),
    new transports.File({ filename: 'debug.log', level: 'debug' }),
  ],
};

const logger = createLogger(options);

if (process.env.NODE_ENV !== 'production') {
  logger.debug('[Logger] Logging initialized at debug level.');
}

export function unknownToString(input: LogPartialMessage): string {
  if (input instanceof Error) {
    return input.message;
  } else if (typeof input === 'object') {
    return JSON.stringify(input);
  } else {
    return `${input}`;
  }
}

type LogPartialMessage = string | object | number | undefined | Error | unknown;

export default (service: string) => {
  const buildServiceMessage = (...messages: unknown[]) => {
    const strings = messages.map(unknownToString);
    return `[${service}] ${strings.join(' - ')}`;
  };
  return {
    debug: (...messages: LogPartialMessage[]) => logger.debug(buildServiceMessage(...messages)),
    info: (...messages: LogPartialMessage[]) => logger.info(buildServiceMessage(...messages)),
    warn: (...messages: LogPartialMessage[]) => logger.warn(buildServiceMessage(...messages)),
    error: (...messages: LogPartialMessage[]) => logger.error(buildServiceMessage(...messages)),
  };
};
