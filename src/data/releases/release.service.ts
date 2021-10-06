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

import { Release, ReleaseState, ReleaseMongooseDocument, ReleaseFilesInput } from './release.model';
import * as releaseModel from './release.model';
import Logger from '../../logger';
const logger = Logger('Release.DataService');

// Values are the list of states that the release can be in to allow transition to the property name
const ALLOWED_STATE_TRANSITIONS: { [key in ReleaseState]: ReleaseState[] } = {
  [ReleaseState.CREATED]: [],
  [ReleaseState.CALCULATING]: [
    ReleaseState.CREATED,
    ReleaseState.CALCULATED,
    ReleaseState.BUILT,
    ReleaseState.ERROR_BUILD,
    ReleaseState.ERROR_CALCULATE,
    ReleaseState.ERROR_PUBLISH,
  ],
  [ReleaseState.CALCULATED]: [ReleaseState.CALCULATING],
  [ReleaseState.ERROR_CALCULATE]: [ReleaseState.CALCULATING],
  [ReleaseState.BUILDING]: [
    ReleaseState.CALCULATED,
    ReleaseState.BUILT,
    ReleaseState.ERROR_BUILD,
    ReleaseState.ERROR_PUBLISH,
  ],
  [ReleaseState.BUILT]: [ReleaseState.BUILDING],
  [ReleaseState.ERROR_BUILD]: [ReleaseState.BUILDING],
  [ReleaseState.PUBLISHING]: [ReleaseState.BUILT, ReleaseState.ERROR_PUBLISH],
  [ReleaseState.PUBLISHED]: [ReleaseState.PUBLISHING],
  [ReleaseState.ERROR_PUBLISH]: [ReleaseState.PUBLISHING],
};

function isAllowedStateTransition(release: Release, newState: ReleaseState): boolean {
  return ALLOWED_STATE_TRANSITIONS[newState].includes(release.state);
}
interface ReleaseStateChangeResponse {
  release: Release;
  previousState: ReleaseState;
  updated: boolean;
  message: string;
}

async function getActiveReleaseOrThrow(error: string): Promise<Release> {
  const activeRelease = await getActiveRelease();
  if (!activeRelease) {
    throw new Error(error);
  }
  return activeRelease;
}

export async function getReleases(): Promise<Release[]> {
  return (await releaseModel.getReleases()).map(toPojo);
}

export async function getReleaseById(_id: string): Promise<Release | undefined> {
  try {
    const release = await releaseModel.getRelease({ _id });
    if (release) {
      return toPojo(release);
    }
  } catch (e) {
    logger.error(`Error fetching release by id: ${e}`);
  }

  return undefined;
}

/**
 *
 * @returns Active release if there is one, otherwise returns undefined
 */
export async function getActiveRelease(): Promise<Release | undefined> {
  const release = await releaseModel.getRelease({ state: { $ne: ReleaseState.PUBLISHED } });
  if (release) {
    return toPojo(release);
  }

  return undefined;
}

/**
 * @returns {Release | undefined} Returns latest release, which is either the active release or the last published release. Returns undefined if no releases have ever been made.
 */
export async function getLatestRelease(): Promise<Release | undefined> {
  const release = await releaseModel.getLatestRelease();

  if (release) {
    return toPojo(release);
  }

  return undefined;
}

export async function updateActiveReleaseFiles(files: ReleaseFilesInput): Promise<Release> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');
  return toPojo(await releaseModel.updateRelease(activeRelease, { files }));
}

export async function updateActiveReleaseIndices(indices: string[]): Promise<Release> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');
  return toPojo(await releaseModel.updateRelease(activeRelease, { indices }));
}
export async function updateActiveReleaseLabel(label: string): Promise<Release> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');
  return toPojo(await releaseModel.updateRelease(activeRelease, { label }));
}
export async function updateActiveReleaseSnapshot(snapshot: string): Promise<Release> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');
  return toPojo(await releaseModel.updateRelease(activeRelease, { snapshot }));
}

export async function beginCalculatingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  let activeRelease = await getActiveRelease();
  if (!activeRelease) {
    // Create a new release if no active release is found
    activeRelease = toPojo(await releaseModel.create());
  }

  if (!activeRelease) {
    logger.error(
      'Unable to get or create an active release for calculating. Throwing error to break the process.',
    );
    throw new Error('Unexpected error reading or creating active release.');
  }

  const previousState = activeRelease.state;

  if (isAllowedStateTransition(activeRelease, ReleaseState.CALCULATING)) {
    logger.info(
      `Transitioning active release from ${previousState} to ${ReleaseState.CALCULATING}. Clearing all existing release calculations and build data.`,
    );
    const release = toPojo(
      await releaseModel.updateRelease(
        activeRelease,
        {
          state: ReleaseState.CALCULATING,
        },
        {
          files: true,
          builtAt: true,
          calculatedAt: true,
          label: true,
          snapshot: true,
          error: true,
          // not clearing indices so we can maintain a reference and remove them during build process
        },
      ),
    );
    return {
      release,
      previousState,
      updated: true,
      message:
        previousState === ReleaseState.CREATED
          ? 'Calculating new release...'
          : 'Updating release calculation...',
    };
  } else {
    // Not allowed to make this state transition
    logger.warn(
      `Cannot transition active release from ${previousState} to ${ReleaseState.CALCULATING}. No action taken.`,
    );
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message:
        previousState === ReleaseState.CALCULATING
          ? 'Already calculating release...'
          : `Cannot begin calculating release that is in '${previousState}' state.`,
    };
  }
}

export async function finishCalculatingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;
  if (isAllowedStateTransition(activeRelease, ReleaseState.CALCULATED)) {
    logger.info(
      `Transitioning active release from ${previousState} to ${ReleaseState.CALCULATED}.`,
    );
    const release = toPojo(
      await releaseModel.updateRelease(activeRelease, {
        state: ReleaseState.CALCULATED,
        calculatedAt: new Date(),
      }),
    );
    return {
      release,
      previousState,
      updated: true,
      message: 'Active release finished calculating.',
    };
  } else {
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message: `Unable to finish calculating from '${previousState}' state.`,
    };
  }
}

export async function beginBuildingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;

  if (isAllowedStateTransition(activeRelease, ReleaseState.BUILDING)) {
    logger.info(
      `Transitioning active release from ${previousState} to ${ReleaseState.BUILDING}. Clearing all existing release build data.`,
    );
    const release = toPojo(
      await releaseModel.updateRelease(
        activeRelease,
        {
          state: ReleaseState.BUILDING,
        },
        {
          builtAt: true,
          label: true,
          snapshot: true,
          error: true,
          // not clearing indices so we can maintain a reference and remove them during build process
        },
      ),
    );

    return {
      release,
      previousState,
      updated: true,
      message: 'Building release...',
    };
  } else {
    // Not allowed to make this state transition
    logger.warn(
      `Cannot transition active release from ${previousState} to ${ReleaseState.BUILDING}. No action taken.`,
    );
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message:
        previousState === ReleaseState.BUILDING
          ? 'Already building release...'
          : `Cannot begin building release that is in '${previousState}' state.`,
    };
  }
}

export async function finishBuildingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;
  if (isAllowedStateTransition(activeRelease, ReleaseState.BUILT)) {
    logger.info(`Transitioning active release from ${previousState} to ${ReleaseState.BUILT}.`);
    const release = toPojo(
      await releaseModel.updateRelease(activeRelease, {
        state: ReleaseState.BUILT,
        builtAt: new Date(),
      }),
    );
    return {
      release,
      previousState,
      updated: true,
      message: 'Active release finished building.',
    };
  } else {
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message: `Unable to finish building from '${previousState}' state.`,
    };
  }
}

export async function beginPublishingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;

  if (isAllowedStateTransition(activeRelease, ReleaseState.PUBLISHING)) {
    logger.info(
      `Transitioning active release from ${previousState} to ${ReleaseState.PUBLISHING}.`,
    );
    const release = toPojo(
      await releaseModel.updateRelease(
        activeRelease,
        {
          state: ReleaseState.PUBLISHING,
        },
        {
          error: true,
        },
      ),
    );

    return {
      release,
      previousState,
      updated: true,
      message: 'Publishing release...',
    };
  } else {
    // Not allowed to make this state transition
    logger.warn(
      `Cannot transition active release from ${previousState} to ${ReleaseState.PUBLISHING}. No action taken.`,
    );
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message:
        previousState === ReleaseState.PUBLISHING
          ? 'Already publishing release...'
          : `Cannot begin publishing release that is in '${previousState}' state.`,
    };
  }
}

export async function finishPublishingActiveRelease(): Promise<ReleaseStateChangeResponse> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;
  if (isAllowedStateTransition(activeRelease, ReleaseState.PUBLISHED)) {
    logger.info(`Transitioning active release from ${previousState} to ${ReleaseState.PUBLISHED}.`);
    const release = toPojo(
      await releaseModel.updateRelease(activeRelease, {
        state: ReleaseState.PUBLISHED,
        publishedAt: new Date(),
      }),
    );
    return {
      release,
      previousState,
      updated: true,
      message: 'Active release finished publishing.',
    };
  } else {
    return {
      release: activeRelease,
      previousState,
      updated: false,
      message: `Unable to finish publishing from '${previousState}' state.`,
    };
  }
}

/**
 * Utility method for setActiveReleaseError
 * @param previousState
 * @returns
 */
function getErrorState(previousState: ReleaseState): ReleaseState | undefined {
  switch (previousState) {
    case ReleaseState.CALCULATING:
      return ReleaseState.ERROR_CALCULATE;
    case ReleaseState.BUILDING:
      return ReleaseState.ERROR_BUILD;
    case ReleaseState.PUBLISHING:
      return ReleaseState.ERROR_PUBLISH;
    default:
      // No logic for handling an error from a static state.
      return undefined;
  }
}
export async function setActiveReleaseError(error: string) {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  const previousState = activeRelease.state;
  const nextState = getErrorState(previousState);
  if (!nextState) {
    throw new Error(
      `Unable to set active release error state from '${previousState}'. Error message provided: ${error}`,
    );
  }

  const release = toPojo(
    await releaseModel.updateRelease(activeRelease, { state: nextState, error }),
  );
}

export async function publishActiveRelease(): Promise<Release> {
  const activeRelease = await getActiveReleaseOrThrow('No active release.');

  return toPojo(
    await releaseModel.updateRelease(activeRelease, {
      publishedAt: new Date(),
      state: ReleaseState.PUBLISHED,
    }),
  );
}

function toPojo(releaseDoc: ReleaseMongooseDocument): Release {
  if (!releaseDoc) {
    throw new Error('cannot convert undefined');
  }
  return {
    _id: releaseDoc._id,
    label: releaseDoc.label,
    version: releaseDoc.version,
    state: releaseDoc.state as ReleaseState,
    error: releaseDoc.error,
    calculatedAt: releaseDoc.calculatedAt,
    builtAt: releaseDoc.builtAt,
    publishedAt: releaseDoc.publishedAt,
    indices: releaseDoc.indices,
    snapshot: releaseDoc.snapshot,
    filesKept: releaseDoc.filesKept,
    filesAdded: releaseDoc.filesAdded,
    filesRemoved: releaseDoc.filesRemoved,
  };
}
