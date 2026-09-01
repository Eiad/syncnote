import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Make an element accept dropped files.
 *
 * Returns `dragProps` to spread onto the drop target and `draggingOver` for
 * rendering the affordance.
 *
 * The behaviour here is all the parts that are easy to get subtly wrong:
 *
 *   - dragenter/dragleave fire for every child element the pointer crosses, so
 *     nesting depth is counted rather than a boolean toggled. A boolean makes
 *     the overlay flicker as the pointer moves across child content.
 *   - dragover must have its default prevented or the drop event never fires
 *     and the browser navigates to the file instead.
 *   - A drag that ends outside the window, or is cancelled with Escape, sends
 *     no dragleave, which would leave the affordance stuck on screen.
 *   - Dropping a file anywhere else on the page also navigates away and loses
 *     state, so those drops are swallowed too.
 *   - Only file drags are intercepted. Dragging selected text into a textarea
 *     relies on the browser's default drop behaviour.
 *
 * @param {(files: FileList) => void} onFiles - Called with the dropped files.
 * @returns {{ dragProps: Object, draggingOver: boolean }}
 */
export function useFileDrop(onFiles) {
  const [draggingOver, setDraggingOver] = useState(false);
  const dragDepth = useRef(0);

  const reset = useCallback(() => {
    dragDepth.current = 0;
    setDraggingOver(false);
  }, []);

  useEffect(() => {
    const swallow = (event) => {
      if (isFileDrag(event)) event.preventDefault();
    };

    const swallowAndReset = (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      reset();
    };

    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallowAndReset);
    window.addEventListener('dragend', reset);

    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallowAndReset);
      window.removeEventListener('dragend', reset);
    };
  }, [reset]);

  const dragProps = {
    onDragEnter: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDraggingOver(true);
    },
    onDragOver: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDraggingOver(false);
    },
    onDrop: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      reset();

      const dropped = event.dataTransfer?.files;
      if (dropped?.length) onFiles(dropped);
    }
  };

  return { dragProps, draggingOver };
}

const isFileDrag = (event) => event.dataTransfer?.types?.includes('Files');
