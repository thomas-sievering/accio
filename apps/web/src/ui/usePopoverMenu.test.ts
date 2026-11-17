import { describe, expect, it } from 'vitest';
import { placePopover } from './usePopoverMenu';

const view = { width: 1200, height: 800 };

describe('placePopover', () => {
  it('opens on its preferred side while it fits there', () => {
    expect(placePopover({ left: 100, top: 300, bottom: 330 }, { width: 260, side: 'below', height: 200 }, view))
      .toEqual({ left: 100, width: 260, top: 336, maxHeight: 800 - 330 - 6 - 12 });
    expect(placePopover({ left: 100, top: 300, bottom: 330 }, { width: 260, side: 'above', height: 200 }, view))
      .toEqual({ left: 100, width: 260, bottom: 800 - 300 + 6, maxHeight: 300 - 6 - 12 });
  });

  it('flips when its side has no room and the other has more', () => {
    const placed = placePopover({ left: 100, top: 700, bottom: 730 }, { width: 260, side: 'below', height: 200 }, view);
    expect(placed).toMatchObject({ bottom: 800 - 700 + 6, maxHeight: 700 - 18 });
    expect(placed.top).toBeUndefined();
  });

  it('stays on its side when it does not fit but the other side has less room', () => {
    expect(placePopover({ left: 100, top: 100, bottom: 130 }, { width: 260, side: 'above', height: 400 }, { width: 1200, height: 230 }))
      .toMatchObject({ bottom: 230 - 100 + 6 });
  });

  it('keeps inside the window edges and narrows to fit', () => {
    expect(placePopover({ left: 1150, top: 300, bottom: 330 }, { width: 310, side: 'above', height: 130, margin: 8, shift: -90 }, view))
      .toMatchObject({ left: 1200 - 310 - 8, width: 310 });
    expect(placePopover({ left: 4, top: 300, bottom: 330 }, { width: 480, side: 'below', height: 220 }, { width: 400, height: 800 }))
      .toMatchObject({ left: 12, width: 400 - 24 });
  });

  it('sets its own height from the room on its side', () => {
    expect(placePopover({ left: 0, top: 300, bottom: 330 }, { width: 340, side: 'above', height: 200, gap: 8, fill: (room) => Math.min(420, room) }, view))
      .toEqual({ left: 12, width: 340, bottom: 508, height: 300 - 20 });
  });
});
