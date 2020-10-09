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

import memoize from 'memoizee';
import axios from 'axios';
import { NextFunction, Request, Response } from 'express';
import TokenUtils from '@icgc-argo/ego-token-utils';
import log from './logger';

const getKey = memoize(
  async (keyUrl: string) => {
    const response = await axios.get(keyUrl);
    return response.data;
  },
  {
    maxAge: 1 * 60 * 60 * 1000, // 1 hour
    preFetch: true,
  },
);

export default function(keyUrl: string, key?: string) {
  if (!keyUrl && !key) {
    throw new Error('must provide either key url or key to validate tokens');
  }
  return (scope: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const { authorization: authorizationHeader } = req.headers;
      const { authorization: authorizationBody }: any = req.body || {};
      const authorization = authorizationHeader || authorizationBody;
      const bearerToken: string = authorization ? authorization.split(' ')[1] : req.query.key;

      let valid = false;
      if (!key && !keyUrl) {
        throw new Error('need either jwt key or key url to verify tokens');
      }
      const publicKey = !!key ? key : await getKey(keyUrl as string);
      const jwtUtils = TokenUtils(publicKey);
      try {
        valid = !!(bearerToken && jwtUtils.isValidJwt(bearerToken));
      } catch (e) {
        log.error(e);
        valid = false;
      }

      if (!valid) {
        res.status(401).end('this request needs a valid jwt to authenticate.');
        return;
      }
      try {
        const scopes = jwtUtils.getPermissionsFromToken(bearerToken);
        if (scopes.includes(scope)) {
          // request has the correct jwt permissions, can proceed
          next();
        } else {
          res.status(403).end('Forbidden, jwt missing the required scopes');
          return;
        }
      } catch (e) {
        log.error(e);
        res.status(403).end('Forbidden');
        return;
      }
    };
  };
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unauthorized';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}
