describe('metrics.ts', () => {
  it('не читает .env и не включает Sentry при импорте — тесты с метриками не уходят в Grafana', () => {
    const loadEnvFile = jest.spyOn(process, 'loadEnvFile');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./metrics');
    });
    expect(loadEnvFile).not.toHaveBeenCalled();
    loadEnvFile.mockRestore();
  });
});
