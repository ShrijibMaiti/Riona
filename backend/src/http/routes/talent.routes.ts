/** People hub, talent side: recruitment, onboarding checklists, performance reviews and goals, training. */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/session';
import { opt, parse } from '../../lib/validate';
import { getCandidate, getJob, listCandidates, listJobs, MoveCandidate, moveCandidate } from '../../modules/people/recruitment.service';
import { ChecklistItem, getOnboardingCase, listOnboarding, setChecklistItem } from '../../modules/people/onboarding.service';
import { getReview, listCycles, listGoals, listReviews, ReviewFilter, ReviewPatch, saveReview } from '../../modules/people/performance.service';
import { listCertifications, listProgrammes } from '../../modules/people/training.service';

type Id = { Params: { id: string } };
const ByEmployee = z.object({ employeeId: opt(z.string().max(40)) });

const talentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/jobs', async (req) => listJobs(req.actor!));
  app.get<Id>('/jobs/:id', async (req) => getJob(req.actor!, req.params.id));
  app.get('/candidates', async (req) => listCandidates(req.actor!, parse(z.object({ jobId: opt(z.string().max(40)) }), req.query).jobId));
  app.get<Id>('/candidates/:id', async (req) => getCandidate(req.actor!, req.params.id));
  app.patch<Id>('/candidates/:id', async (req) => moveCandidate(req.actor!, req.params.id, parse(MoveCandidate, req.body).stage));

  app.get('/onboarding', async (req) => listOnboarding(req.actor!));
  app.get<Id>('/onboarding/:id', async (req) => getOnboardingCase(req.actor!, req.params.id));
  app.patch<{ Params: { id: string; itemId: string } }>('/onboarding/:id/items/:itemId', async (req) =>
    setChecklistItem(req.actor!, req.params.id, req.params.itemId, parse(ChecklistItem, req.body).done));

  app.get('/review-cycles', async (req) => listCycles(req.actor!));
  app.get('/reviews', async (req) => listReviews(req.actor!, parse(ReviewFilter, req.query)));
  app.get<Id>('/reviews/:id', async (req) => getReview(req.actor!, req.params.id));
  app.put<Id>('/reviews/:id', async (req) => saveReview(req.actor!, req.params.id, parse(ReviewPatch, req.body)));
  app.get('/goals', async (req) => listGoals(req.actor!, parse(ByEmployee, req.query).employeeId));

  app.get('/training/programmes', async (req) => listProgrammes(req.actor!));
  app.get('/training/certifications', async (req) => listCertifications(req.actor!, parse(ByEmployee, req.query).employeeId));
};

export default talentRoutes;
