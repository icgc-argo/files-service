/*
 * Copyright (c) 2023 The Ontario Institute for Cancer Research. All rights reserved
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

export type AsyncCache<Data, Inputs> = {
	clear: (inputs: Inputs) => void;
	get: (inputs: Inputs) => Promise<Data>;
};

export type FetchCache<T> =
	| {
			active: false;
			data: T;
			expiry: number;
	  }
	| {
			active: true;
			promise: Promise<T>;
	  };

/**
 * Create an AsyncCache.
 *
 * An AsyncCache will store values returned by an async function (the `action`) for each unique set of inputs.
 * On subsequent requests for the same set of inputs the stored value will be returned so that the work of the action
 * does not need to be repeated.
 *
 * The AsyncCache will also track which async actions are in progress, so if a second request is made before the initial
 * request is complete, the second requester will await for the original request to complete and then receive the same result.
 *
 * `options`:
 * - `hashFunction`: A function that will convert the provided inputs into a unique string to use as the identifier of the request.
 *                 The default hash function uses `JSON.stringify(inputs)`
 * - `expirtyTime`: Time in miliseconds that the cached value will be kept for. The expiry timer starts after the initial action completes.
 *
 *
 * @param action (inputs: Inputs) => Promise<Data>
 * @param options {hashFunction?: (inputs: Inputs) => string; expiryTime?: number}
 */
const AsyncCache = <Data, Inputs extends object>(
	action: (inputs: Inputs) => Promise<Data>,
	options?: { hashFunction?: (inputs: Inputs) => string; expiryTime?: number },
): AsyncCache<Data, Inputs> => {
	// apply defaults for undefined options
	const _hashFunction = options?.hashFunction !== undefined ? options.hashFunction : (i: Inputs) => JSON.stringify(i);
	const _expiryTime = options?.expiryTime !== undefined ? options.expiryTime : 60 * 1000 * 60; // One hour default expiry time

	// initialize in memory cache
	const CACHE: Record<string, FetchCache<Data>> = {};

	// clear - remove cached value
	const clear = (inputs: Inputs): void => {
		const hash = _hashFunction(inputs);
		delete CACHE['hash'];
		return;
	};

	// get - cached action resolver
	const get = async (inputs: Inputs): Promise<Data> => {
		const hash = _hashFunction(inputs);

		const actionWithCaching = async () => {
			const promise = new Promise<Data>(async (resolve, _) => {
				const response = await action(inputs);
				CACHE[hash] = { active: false, data: response, expiry: Date.now() + _expiryTime };
				resolve(response);
			});
			CACHE[hash] = { active: true, promise };
			return promise;
		};

		const cacheHit = CACHE[hash] || undefined;

		if (cacheHit) {
			if (cacheHit.active) {
				return cacheHit.promise;
			} else if (cacheHit.expiry < Date.now()) {
				return actionWithCaching();
			} else {
				return cacheHit.data;
			}
		} else {
			return actionWithCaching();
		}
	};

	return { clear, get };
};
export default AsyncCache;
