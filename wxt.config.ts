import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'IRCTC Autofill',
    description: 'Autofill journey and passenger details on the new IRCTC site. Login and payment stay manual.',
    permissions: ['storage'],
    host_permissions: ['https://www.irctc.co.in/*'],
  },
});
