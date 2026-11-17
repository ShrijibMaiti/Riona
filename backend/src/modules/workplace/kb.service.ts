/** The knowledge base: policies and guides. Open to all staff. */
import type { KbArticle } from '@riona/shared';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';

const toArticle = (k: { id: string; slug: string; title: string; category: string; updated: string; authorId: string; sections: unknown }): KbArticle => ({
  id: k.id, slug: k.slug, title: k.title, category: k.category, updated: k.updated, authorId: k.authorId, sections: k.sections as KbArticle['sections'],
});

/** GET /kb */
export async function listKb(actor: Actor): Promise<KbArticle[]> {
  authorize(actor, 'directory', 'view');
  return (await db.selectFrom('kbArticles').selectAll().orderBy('id').execute()).map(toArticle);
}

/** GET /kb/:slug */
export async function getKbArticle(actor: Actor, slug: string): Promise<KbArticle> {
  authorize(actor, 'directory', 'view');
  const k = await db.selectFrom('kbArticles').selectAll().where('slug', '=', slug).executeTakeFirst();
  if (!k) throw notFound('Article not found');
  return toArticle(k);
}
