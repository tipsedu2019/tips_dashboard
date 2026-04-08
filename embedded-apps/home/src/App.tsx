/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AppLayout from './components/layout/AppLayout';
import HomeLandingPage from './components/home/HomeLandingPage';

export default function App() {
  return (
    <AppLayout>
      <HomeLandingPage />
    </AppLayout>
  );
}
