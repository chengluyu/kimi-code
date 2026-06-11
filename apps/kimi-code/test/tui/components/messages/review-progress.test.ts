import { describe, expect, it } from 'vitest';

import { ReviewProgressComponent } from '#/tui/components/messages/review-progress';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('ReviewProgressComponent', () => {
  it('renders started review details', () => {
    const component = new ReviewProgressComponent({
      state: 'started',
      title: 'Review started',
      detail: '1 file: +2 -1 · standard',
    });

    const text = strip(component.render(80).join('\n'));

    expect(text).toContain('Review started');
    expect(text).toContain('1 file: +2 -1 · standard');
  });

  it('renders terminal review states', () => {
    const completed = strip(
      new ReviewProgressComponent({
        state: 'completed',
        title: 'Review completed',
        detail: 'No actionable findings.',
      }).render(80).join('\n'),
    );
    const failed = strip(
      new ReviewProgressComponent({
        state: 'failed',
        title: 'Review failed',
        detail: 'worker failed',
      }).render(80).join('\n'),
    );

    expect(completed).toContain('Review completed');
    expect(completed).toContain('No actionable findings.');
    expect(failed).toContain('Review failed');
    expect(failed).toContain('worker failed');
  });
});
