// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Tweener = imports.ui.tweener;

function ensureActorVisibleInScrollView(scrollView, actor) {
    let adjustment = scrollView.vscroll.adjustment;
    let [value, lower, upper, stepIncrement, pageIncrement, pageSize] = adjustment.get_values();

    let offset = 0;
    let vfade = scrollView.get_effect("fade");
    if (vfade)
        offset = vfade.vfade_offset;

    let box = actor.get_allocation_box();
    let y1 = box.y1, y2 = box.y2;

    let parent = actor.get_parent();
    while (parent != scrollView) {
        if (!parent)
            throw new Error("actor not in scroll view");

        let box = parent.get_allocation_box();
        y1 += box.y1;
        y2 += box.y1;
        parent = parent.get_parent();
    }

    if (y1 < value + offset)
        value = Math.max(0, y1 - offset);
    else if (y2 > value + pageSize - offset)
        value = Math.min(upper, y2 + offset - pageSize);
    else
        return;

    Tweener.addTween(adjustment,
                     { value: value,
                       time: SCROLL_TIME,
                       transition: 'easeOutQuad' });
}
