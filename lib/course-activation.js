'use strict';

const { createCourseDiagnostic } = require('./course-diagnostics');
const { normalizeCourseSource } = require('./course-identity');

function activationDiagnostic(code, courseId = null) {
  const records = {
    ACTIVATION_SUPERSEDED: {
      severity: 'info',
      message: 'A newer course activation replaced this request.',
      recovery: 'Use the newer active course.',
    },
    ACTIVATION_OBSERVER_FAILED: {
      severity: 'warning',
      message: 'The course committed, but a post-commit update could not be delivered.',
      recovery: 'Refresh connected clients to read the committed course state.',
    },
    ACTIVATION_PREPARE_FAILED: {
      severity: 'error',
      message: 'Course activation could not be prepared.',
      recovery: 'Retry the course activation or select the course again.',
    },
  };
  return createCourseDiagnostic({
    code,
    stage: 'activation',
    courseId,
    ...(records[code] || records.ACTIVATION_PREPARE_FAILED),
  });
}

function resolvedPublicPackage(candidate, courseRevision) {
  if (!candidate || typeof candidate !== 'object' ||
      !/^osm:(?:node|way|relation):[1-9][0-9]*$/.test(candidate.courseId) ||
      !/^[a-f0-9]{64}$/.test(candidate.contentRevision)) {
    throw new TypeError('Prepared course candidate is invalid');
  }
  return Object.freeze({
    courseId: candidate.courseId,
    courseRevision,
    contentRevision: candidate.contentRevision,
    presentation: candidate.presentation,
    terrainPatches: candidate.terrainPatches,
    assetManifest: candidate.publicAssetManifest,
    diagnostics: candidate.diagnostics,
  });
}

function createCourseActivationManager({
  acquireCourse,
  prepareCandidate,
  commitPreparedActivation,
  onCommitted = null,
  onPrepareFailed = null,
  deriveSource = (request) => normalizeCourseSource(request?.source || request),
} = {}) {
  if (typeof acquireCourse !== 'function' ||
      typeof prepareCandidate !== 'function' ||
      typeof commitPreparedActivation !== 'function' ||
      typeof deriveSource !== 'function') {
    throw new TypeError('Course activation manager dependencies are required');
  }

  let activationGeneration = 0;
  let courseRevision = 0;
  let activeState = null;

  function superseded(generation, courseId) {
    return {
      status: 'superseded',
      generation,
      diagnostic: activationDiagnostic('ACTIVATION_SUPERSEDED', courseId),
    };
  }

  async function activate(request) {
    const generation = ++activationGeneration;
    let source;
    try {
      source = deriveSource(request);
      const course = await acquireCourse(request, {
        source,
        abortDifferent: true,
        generation,
      });
      if (generation !== activationGeneration) return superseded(generation, source.courseId);

      const candidate = await prepareCandidate({
        course,
        request,
        source,
        generation,
      });
      if (generation !== activationGeneration) return superseded(generation, source.courseId);
      if (candidate.courseId !== source.courseId) {
        throw new TypeError('Prepared candidate identity disagrees with the request');
      }

      const nextRevision = courseRevision + 1;
      const resolvedPackage = resolvedPublicPackage(candidate, nextRevision);
      const commitPayload = Object.freeze({
        candidate,
        resolvedPackage,
        generation,
        timerSpecification: candidate.hdDescriptors?.length
          ? Object.freeze({ courseRevision: nextRevision })
          : null,
      });
      commitPreparedActivation(commitPayload);
      courseRevision = nextRevision;
      activeState = Object.freeze({
        publicPackage: resolvedPackage,
        privateAssetManifest: candidate.privateAssetManifest,
      });

      let observerDiagnostic = null;
      if (typeof onCommitted === 'function') {
        try {
          await onCommitted(commitPayload);
        } catch {
          observerDiagnostic = activationDiagnostic(
            'ACTIVATION_OBSERVER_FAILED',
            source.courseId,
          );
        }
      }
      return {
        status: 'committed',
        generation,
        courseRevision: nextRevision,
        package: resolvedPackage,
        ...(observerDiagnostic ? { observerDiagnostic } : {}),
      };
    } catch (error) {
      if (generation !== activationGeneration) {
        return superseded(generation, source?.courseId || null);
      }
      if (typeof onPrepareFailed === 'function') {
        try {
          onPrepareFailed(error, Object.freeze({
            generation,
            courseId: source?.courseId || null,
          }));
        } catch {
          // Failure reporting cannot change activation state or public output.
        }
      }
      return {
        status: 'failed',
        generation,
        diagnostic: activationDiagnostic(
          'ACTIVATION_PREPARE_FAILED',
          source?.courseId || null,
        ),
      };
    }
  }

  return Object.freeze({
    activate,
    current() {
      return activeState?.publicPackage || null;
    },
    lookupPrivateAsset(contentRevision, assetKey) {
      if (!activeState || activeState.publicPackage.contentRevision !== contentRevision) return null;
      return activeState.privateAssetManifest?.[assetKey] || null;
    },
  });
}

module.exports = {
  createCourseActivationManager,
};
