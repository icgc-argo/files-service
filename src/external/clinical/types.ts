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

import { z as zod } from 'zod';

//  Record<string, string | number | boolean | undefined>;
export const ClinicalInfo = zod.record(zod.union([zod.string(), zod.number(), zod.boolean()]).optional());

export const ClinicalSample = zod.object({
  clinicalInfo: ClinicalInfo,
  sampleId: zod.string(),
  submitterId: zod.string(),
  sampleType: zod.string(),
});
export const ClinicalSpecimen = zod.object({
  clinicalInfo: ClinicalInfo,
  samples: zod.array(ClinicalSample),
  specimenId: zod.string(),
  submitterId: zod.string(),
});

/**
 * This object is an partial representation of the data returned from the clinical donor api. We are only validating the fields that
 * are relevant to the file service's usage. When additional information from the clinical API is needed those fields should be added
 * to this schema definition.
 *
 * Note: we receive all dates as strings. The type declaration here has them listed as strings, but if it makes sense in the future
 * we can update the Zod schema to parse them into dates.
 */
export const ClinicalDonor = zod.object({
  donorId: zod.string(),
  gender: zod.string(),
  programId: zod.string(),

  submitterId: zod.string(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  schemaMetadata: zod.object({
    isValid: zod.boolean(),
    lastValidSchemaVersion: zod.string(),
    originalSchemaVersion: zod.string(),
    lastMigrationId: zod.string(),
  }),
  completionStats: zod
    .object({
      coreCompletion: zod.object({
        donor: zod.number(),
        specimens: zod.number(),
        primaryDiagnosis: zod.number(),
        followUps: zod.number(),
        treatments: zod.number(),
      }),
      overriddenCoreCompletion: zod.array(zod.string()),
      coreCompletionPercentage: zod.number(),
      coreCompletionDate: zod.string().nullable(),
    })
    .optional(),
});
export type ClinicalDonor = zod.infer<typeof ClinicalDonor>;
