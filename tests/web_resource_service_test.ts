import { WebResourceRepository } from '../src/repositories/web_resource.ts';
import { WebFileDownloader } from '../src/services/web_file_download.ts';
import { WebResourceService } from '../src/services/web_resource.ts';

Deno.test('WebResourceService serves what a test registered for each spelling of a URL', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const registration = webResources.registerWebResource({
    url: 'https://Example.com/files/report.pdf#page=2',
    status: 200,
    contentType: 'application/pdf',
    content: new TextEncoder().encode('%PDF'),
  });
  if (
    !registration.registered ||
    registration.resource.url !== 'https://example.com/files/report.pdf#page=2'
  ) {
    throw new Error(`Expected the canonical URL, received ${JSON.stringify(registration)}`);
  }

  const response = await webResources.fetchWebResource(
    new Request('https://EXAMPLE.com/files/report.pdf'),
  );
  if (
    response.status !== 200 || response.headers.get('Content-Type') !== 'application/pdf' ||
    response.headers.get('Content-Length') !== '4' || await response.text() !== '%PDF'
  ) {
    throw new Error('Expected the registered PDF to be served');
  }

  const replacement = webResources.registerWebResource({
    url: 'https://example.com/files/report.pdf',
    status: 302,
    location: '/files/v2/report.pdf',
    content: new Uint8Array(),
  });
  const redirect = await webResources.fetchWebResource(
    new Request('https://example.com/files/report.pdf'),
  );
  if (
    !replacement.registered || redirect.status !== 302 ||
    redirect.headers.get('Location') !== '/files/v2/report.pdf' || redirect.body !== null
  ) {
    throw new Error('Expected a registration to replace the earlier one for the same URL');
  }
});

Deno.test('WebResourceService refuses invalid URLs and answers unregistered ones as unreachable', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const registration = webResources.registerWebResource({
    url: 'ftp://example.com/report.pdf',
    status: 200,
    content: new Uint8Array(),
  });
  if (
    registration.registered || registration.reason !== 'url_invalid' ||
    registration.urlError !== 'Unsupported URL protocol'
  ) {
    throw new Error(`Expected the URL to be refused, received ${JSON.stringify(registration)}`);
  }

  try {
    await webResources.fetchWebResource(new Request('https://example.com/missing.pdf'));
  } catch (error) {
    if (error instanceof TypeError) {
      return;
    }
    throw error;
  }
  throw new Error('Expected an unregistered URL to be unreachable');
});

Deno.test('WebResourceService serves URLs with userinfo, which TDLib reads', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const registration = webResources.registerWebResource({
    url: 'https://user:secret@example.com/private.pdf',
    status: 200,
    contentType: 'application/pdf',
    content: new TextEncoder().encode('%PDF'),
  });
  const downloader = new WebFileDownloader({
    fetchWebResource: (request) => webResources.fetchWebResource(request),
    timeoutMilliseconds: 1_000,
    maxRedirects: 5,
  });
  const download = await downloader.download('https://user:secret@example.com/private.pdf', 100);
  if (
    !registration.registered || !download.downloaded || download.mediaType !== 'application/pdf'
  ) {
    throw new Error(`Expected the resource to be served, received ${JSON.stringify(download)}`);
  }
});
