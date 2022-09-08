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

import stream from 'stream';

// source: https://www.derpturkey.com/nodejs-async-generators-for-streaming/
// Converts a stream into an AsyncGenerator that allows reading bytes
// of data from the stream in the chunk size specified. This function
// has some similarities to the `;streamToGenerator` function.
export function streamToAsyncGenerator<T>(
  reader: stream.Readable,
  chunkSize?: number,
): AsyncGenerator<T, void, unknown> {
  // Immediately invoke the AsyncGenerator function which will closure
  // scope the stream and returns the AsyncGenerator instance
  return (async function* genFn() {
    // Construct a promise that will resolve when the Stream has
    // ended. We use it below as a conditional resolution of the
    // readable and end events.
    const endPromise = signalEnd(reader);

    while (true) {
      // Next, similar to readToEnd function, we loop on the
      // Stream until we have read all of the data that we
      // can from the stream.
      while (reader.readable) {
        // First try to read the chunk size, but if that fails
        // then try reading the remainder of the stream.
        const val = reader.read(chunkSize) || reader.read();

        // Either yield the contents to our generator or there
        // was no data and we are no longer readable and need
        // to wait for more info
        if (val) yield val;
        else break;
      }

      // We are no longer readable and one of two things will
      // happen now: `;readable` or `;end` will fire. We construct
      // a new `;readable` signal to wait for the next signal.
      const readablePromise = signalReadable(reader);

      // We wait for either the `;end` or `;readable` event to fire
      const result = await Promise.race([endPromise, readablePromise]);
      if (result == 'done') {
        return;
      }
    }
  })();
}

// Resolves when the stream fires its next `;readable` event. We use the
// event `;once` method so that it only ever fires on the next `;readable`
// event
export async function signalReadable(reader: stream.Readable) {
  return new Promise<string>(resolve => {
    reader.once('readable', () => resolve('not yet'));
  });
}

// Resolves when the stream fires the `;end` event. We use the `;once`
// method so that the promise only resolves once.
export async function signalEnd(reader: stream.Readable) {
  return new Promise<string>(resolve => {
    reader.once('end', () => resolve('done'));
  });
}
