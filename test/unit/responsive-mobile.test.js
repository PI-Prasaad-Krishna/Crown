import { suite, test, assert, assertTrue } from '../runner.js';
import fs from 'node:fs';
import path from 'node:path';
import { rootDir } from '../setup.js';

suite('Feature: Responsive Design & Mobile (Android) Readiness', () => {
  const cssPath = path.join(rootDir, 'src', 'css', 'style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  test('Includes standard tablet/mobile breakpoint @media (max-width: 768px)', () => {
    assertTrue(cssContent.includes('@media (max-width: 768px)'), 'CSS must include 768px mobile breakpoint');
  });

  test('Includes compact mobile breakpoint @media (max-width: 480px)', () => {
    assertTrue(cssContent.includes('@media (max-width: 480px)'), 'CSS must include 480px compact mobile breakpoint');
  });

  test('Hides desktop window controls on mobile devices', () => {
    assertTrue(cssContent.includes('.window-controls'), 'Must target window controls');
    assertTrue(cssContent.includes('display: none !important'), 'Window controls must be suppressed on mobile');
  });

  test('Implements touch scrolling and momentum for tab bar', () => {
    assertTrue(cssContent.includes('-webkit-overflow-scrolling: touch'), 'Must have touch momentum scrolling');
    assertTrue(cssContent.includes('overflow-x: auto'), 'Tab bar must be scrollable horizontally on mobile');
  });

  test('Provides minimum 36px-44px touch targets for navigation buttons', () => {
    assertTrue(cssContent.includes('min-width: 36px') || cssContent.includes('min-width: 40px') || cssContent.includes('min-width: 44px'), 'Buttons must meet touch target standards');
  });

  test('Converts settings shell to stacked column layout on mobile', () => {
    assertTrue(cssContent.includes('.crown-settings-shell'), 'Must target settings shell');
    assertTrue(cssContent.includes('flex-direction: column'), 'Settings must stack on mobile');
  });

  test('Adapts defense hub metrics grid to 2-column or 1-column on small screens', () => {
    assertTrue(cssContent.includes('grid-template-columns: repeat(2, 1fr)') || cssContent.includes('grid-template-columns: 1fr 1fr'), 'Metrics must adapt to 2 columns on mobile');
  });

  test('Adapts panels to mobile bottom-sheet overlays', () => {
    assertTrue(cssContent.includes('border-radius: 18px 18px 0 0') || cssContent.includes('bottom: 0'), 'Popovers must dock as bottom sheets on mobile');
  });

  test('Keeps .omnibox-container overflow visible so URL bar suggestions are never clipped', () => {
    const blocks = cssContent.match(/\.omnibox-container\s*\{[^}]*\}/g) || [];
    assertTrue(blocks.length >= 1, 'CSS must define .omnibox-container');
    for (const block of blocks) {
      assertTrue(!/overflow\s*:\s*hidden/i.test(block), '.omnibox-container must not set overflow: hidden (clips #omnibox-suggestions)');
    }
  });
});

