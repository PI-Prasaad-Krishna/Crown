import { suite, test, assert, assertEqual, assertTrue, assertFalse } from '../runner.js';
import { DownloadManager } from '../../src/js/downloads.js';

suite('Feature: Download Manager', () => {
  test('Identifies downloadable binary and media file extensions', () => {
    const dm = new DownloadManager();

    assertTrue(dm.isDownloadableUrl('https://example.com/archive.zip'));
    assertTrue(dm.isDownloadableUrl('https://example.com/setup.exe'));
    assertFalse(dm.isDownloadableUrl('https://example.com/document.pdf'));
    assertTrue(dm.isDownloadableUrl('https://example.com/app.apk'));
    assertTrue(dm.isDownloadableUrl('https://example.com/video.mp4?token=abc'));

    assertFalse(dm.isDownloadableUrl('https://example.com/page.html'));
    assertFalse(dm.isDownloadableUrl('https://example.com/'));
  });

  test('Tracks active and completed download tasks', async () => {
    const dm = new DownloadManager();
    const id = await dm.startDownload('https://example.com/package.zip', 'custom-name.zip');
    assertEqual(dm.downloads.length, 1);
    assertEqual(dm.downloads[0].filename, 'custom-name.zip');
  });

  test('Clears completed downloads while preserving active state', () => {
    const dm = new DownloadManager();
    dm.downloads = [
      { id: 'dl-1', filename: 'file1.zip', state: 'completed' },
      { id: 'dl-2', filename: 'file2.iso', state: 'downloading' }
    ];

    dm.clearCompleted();
    assertEqual(dm.downloads.length, 1);
    assertEqual(dm.downloads[0].id, 'dl-2');
  });
});

