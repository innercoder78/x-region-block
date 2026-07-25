import { evaluateXAccountLink } from './account-evaluation.js';
import {
  findLocationBadge,
  removeLocationBadge,
  renderLocationBadge,
} from './location-badge-renderer.js';

export const ACCOUNT_PRESENTATION_VERSION = 1;

/**
 * Evaluates and presents one explicitly supplied account link without page discovery.
 */
export function presentXAccountLink(link, badgeContainer, observation, settings) {
  findLocationBadge(badgeContainer);
  const evaluation = evaluateXAccountLink(link, observation, settings);

  if (evaluation === null) {
    removeLocationBadge(badgeContainer);
    return null;
  }

  renderLocationBadge(badgeContainer, evaluation.subject.location);
  return evaluation;
}
