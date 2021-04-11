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

import { differenceInMonths } from 'date-fns';

import { EmbargoStage, File } from '../data/files';

/**
 * Calculating the embargo stage a file should be in.
 *
 * Stage is calculated from a file's First Published Date, based on the following timeline:
 * 0-12 months  = PROGRAM_ONLY
 * 12-18 months = MEMBER_ACCESS
 * 18-24 months = ASSOCIATE_ACCESS
 * > 24 months  = PUBLIC
 *
 * Important Note: this calculates what stage a file should be put into, but transitioning
 *   from ASSOCIATE_ACCESS to PUBLIC requires a Release process. This method may return PUBLIC
 *   but that simply indicates it could become PUBLIC, the recorded file should not be immediately
 *   stored with embargoStage=PUBLIC.
 */
export const calculateEmbargoStage = (file: File): EmbargoStage => {
  const monthsPublished = differenceInMonths(new Date(), file.firstPublished);

  // Set expectedStage based on time passed since published
  let expectedStage = EmbargoStage.PROGRAM_ONLY;

  switch (true) {
    case monthsPublished >= 24:
      expectedStage = EmbargoStage.PUBLIC;
      break;
    case monthsPublished >= 18:
      expectedStage = EmbargoStage.ASSOCIATE_ACCESS;
      break;
    case monthsPublished >= 12:
      expectedStage = EmbargoStage.MEMBER_ACCESS;
      break;
    default:
      // Doesn't change anything, incldued for completeness.
      expectedStage = EmbargoStage.PROGRAM_ONLY;
      break;
  }

  return expectedStage;
};
