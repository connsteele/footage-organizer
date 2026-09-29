import { Link } from 'react-router-dom';
import styles from './App.module.css';

export function Shortcuts() {
  return (
    <>
      <div className={styles.breadcrumb}>
        <Link to="/">Projects</Link>
        <span>/</span>Keyboard shortcuts
      </div>
      <div className={styles.pageHeading}>
        <div>
          <h1>Keyboard shortcuts</h1>
          <p>Controls for reviewing footage in Preview.</p>
        </div>
      </div>
      <section className={styles.guideCard} aria-labelledby="playback-shortcuts">
        <h2 id="playback-shortcuts">Playback</h2>
        <p>
          Open a clip’s Preview to enable J/K/L. These keys work anywhere on the page except while
          typing a name or note, using a selection menu, or working in a dialog.
        </p>
        <dl className={styles.shortcutList}>
          <div>
            <dt>
              <kbd>J</kbd>
            </dt>
            <dd>Rewind from pause. Press again to rewind faster.</dd>
          </div>
          <div>
            <dt>
              <kbd>K</kbd>
            </dt>
            <dd>Pause. The next J or L starts at normal speed.</dd>
          </div>
          <div>
            <dt>
              <kbd>L</kbd>
            </dt>
            <dd>Play forward from pause. Press again to play faster.</dd>
          </div>
          <div>
            <dt>Opposite key</dt>
            <dd>
              Step down the current speed toward pause, then change direction. For example: L, L, L
              gives forward 4×; J steps down to 2×, then 1×, then pause, then rewind 1×.
            </dd>
          </div>
        </dl>
        <p>
          Speeds: 1×, 2×, 4×, 8×, and 16× in either direction. Tap for each step; holding a key does
          not keep increasing the speed. The player shows its direction and speed beneath the video.
        </p>
        <p>
          Rewind is silent backward scrubbing and can be less smooth with large clips. Forward
          playback uses the normal video player; audio may be muted at higher speeds. Closing
          Preview stops playback. Changing browser tabs pauses rewind.
        </p>
      </section>
      <section className={styles.guideCard} aria-labelledby="review-shortcuts">
        <h2 id="review-shortcuts">Names and markers</h2>
        <dl className={styles.shortcutList}>
          <div>
            <dt>
              <kbd>Tab</kbd>
            </dt>
            <dd>Move between buttons, fields, and marker cards. Use Shift + Tab to go back.</dd>
          </div>
          <div>
            <dt>
              <kbd>Enter</kbd> / <kbd>Space</kbd>
            </dt>
            <dd>
              Activate a focused button or marker card. Marker cards seek to their time in Preview.
            </dd>
          </div>
          <div>
            <dt>
              <kbd>←</kbd> / <kbd>→</kbd>
            </dt>
            <dd>Adjust the focused seek slider. Home and End go to the start and end.</dd>
          </div>
        </dl>
        <p>
          While editing names or notes, normal typing and text-editing shortcuts stay available.
          Modified shortcuts such as Ctrl + L remain with your browser. J/K/L shortcuts are inactive
          when no Preview is open.
        </p>
      </section>
    </>
  );
}
