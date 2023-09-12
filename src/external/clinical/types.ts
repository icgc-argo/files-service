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
  tumourNormalDesignation: zod.string(),
  specimenType: zod.string(),
  specimenTissueSource: zod.string(),
});
// TODO: The properties we want to index from the following types should be declared.
export const ClinicalFollowUp = zod.object({
  clinicalInfo: ClinicalInfo,
  followUpId: zod.string(),
});
export const ClinicalPrimaryDiagnosis = zod.object({
  clinicalInfo: ClinicalInfo,
  primaryDiagnosisId: zod.string(),
});
export const ClinicalTherapy = zod.object({
  clinicalInfo: ClinicalInfo,
  therapyId: zod.string(),
});
export const ClinicalTreatment = zod.object({
  clinicalInfo: ClinicalInfo,
  therapies: zod.array(ClinicalTherapy),
  treatmentId: zod.string(),
});
export const ClinicalFamilyHistory = zod.object({
  clinicalInfo: ClinicalInfo,
  familyHistoryId: zod.string(),
});
export const ClinicalExposure = zod.object({
  clinicalInfo: ClinicalInfo,
  exposureId: zod.string(),
});
export const ClinicalComorbidity = zod.object({
  clinicalInfo: ClinicalInfo,
  comorbidityId: zod.string(),
});
export const ClinicalBiomarker = zod.object({
  clinicalInfo: ClinicalInfo,
  biomarkerId: zod.string(),
});

/**
 * The specific content in ClinicalDonor type is subject to change as the data-dictionary is updated,
 * so we try to only define here the bare minimum of fields that are needed to interact with and index the clinical data.
 * For this reason, the Zod schema must allow additional properties to be present (not strict).
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
  completionStats: zod.object({
    coreCompletion: zod.object({
      donor: zod.number(),
      specimens: zod.number(),
      primaryDiagnosis: zod.number(),
      followUps: zod.number(),
      treatments: zod.number(),
    }),
    overriddenCoreCompletion: zod.array(zod.string()),
    coreCompletionPercentage: zod.number(),
    coreCompletionDate: zod.string(),
  }),

  // core
  specimens: zod.array(ClinicalSpecimen),
  followUps: zod.array(ClinicalFollowUp),
  primaryDiagnoses: zod.array(ClinicalPrimaryDiagnosis),
  treatments: zod.array(ClinicalTreatment),

  // expanded
  familyHistory: zod.array(ClinicalFamilyHistory),
  exposure: zod.array(ClinicalExposure),
  comorbidity: zod.array(ClinicalComorbidity),
  biomarker: zod.array(ClinicalBiomarker),
});
export type ClinicalDonor = zod.infer<typeof ClinicalDonor>;
