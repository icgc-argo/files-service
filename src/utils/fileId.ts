/*
 * Copyright (c) 2026 The Ontario Institute for Cancer Research. All rights reserved
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

import { Errors } from './errors';

export const FILE_ID_PREFIX = 'FL';

/**
 * File IDs are stored as integers but are always exported as strings with a prefix.
 * The default prefix is `FL`, but to ensure unique values across federated data centers we also
 * add a unique string for this given data center, for example a data center hosted in Canada may
 * use the datacenter ID prefix `CA`, so the full prefix for File IDs will be `CA-FL`.
 * @returns
 */
export const getFileIdPrefix = (): string => {
	// TODO: Read this form config, need to refactor out the async nature of the config.
	const customPrefix = process.env.DATACENTER_ID_PREFIX;
	return customPrefix ? `${customPrefix}-${FILE_ID_PREFIX}` : FILE_ID_PREFIX;
};

export const fileIdToString = (id: number): string => `${getFileIdPrefix()}${id}`;

export const fileIdToNumber = (id: string): number => {
	const prefix = getFileIdPrefix();
	if (!id.startsWith(prefix)) {
		throw new Errors.InvalidArgument(
			`This file ID does not start with the correct prefix (${prefix}) for this server. Expected File ID format: ${prefix}1234`,
		);
	}
	const numId = Number(id.slice(prefix.length));
	if (!numId || Number.isNaN(numId)) {
		throw new Errors.InvalidArgument(`Could not convert file ID to number. ${id} is not a valid file ID.`);
	}
	return numId;
};
