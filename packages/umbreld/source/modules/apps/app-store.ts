import type Umbreld from '../../index.js'
import runEvery from '../utilities/run-every.js'
import AppRepository from './app-repository.js'

export default class AppStore {
	#umbreld: Umbreld
	#stopUpdating?: () => void
	logger: Umbreld['logger']
	updateInterval = '5m'
	defaultAppStoreRepo: string

	constructor(umbreld: Umbreld, {defaultAppStoreRepo}: {defaultAppStoreRepo: string}) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.defaultAppStoreRepo = defaultAppStoreRepo
	}

	async start() {
		this.logger.log('Initialising app store')

		// Set default app repository on first start
		if ((await this.#umbreld.store.get('appRepositories')) === undefined) {
			await this.#umbreld.store.set('appRepositories', [this.defaultAppStoreRepo])
		}

		// Initialise repositories
		this.logger.log(`Initialising repositories...`)
		await this.update()
		this.logger.log(`Repositories initialised!`)

		// Kick off update loop
		this.logger.log(`Checking repositories for updates every ${this.updateInterval}`)
		this.#stopUpdating = runEvery(this.updateInterval, () => this.update(), {runInstantly: false})
	}

	async stop() {
		if (this.#stopUpdating) this.#stopUpdating()
	}

	async getRepositories() {
		const repositoryUrls = await this.#umbreld.store.get('appRepositories')
		const repositories = repositoryUrls.map((url) => new AppRepository(this.#umbreld, url))

		return repositories
	}

	async update() {
		const repositories = await this.getRepositories()
		if (!repositories) throw new Error('App store not initialised')
		for (const repository of repositories) {
			try {
				await repository.update()
			} catch (error) {
				this.logger.error(`Failed to update ${repository.url}: ${(error as Error).message}`)
			}
		}
	}

	async registry() {
		const repositories = await this.getRepositories()
		if (!repositories) throw new Error('App store not initialised')
		const registryPromises = repositories.map((repository) =>
			repository.readRegistry().catch((error) => {
				this.logger.error(`Failed to read registry from ${repository.url}: ${(error as Error).message}`)
				return null
			}),
		)
		const registry = await Promise.all(registryPromises)

		// Remove failed reads
		return registry.filter(Boolean)
	}

	async addRepository(url: string) {
		// Check if repo already exists
		const existingRepositories = await this.getRepositories()
		if (existingRepositories.some((existingRepo) => existingRepo.url === url)) {
			throw new Error(`Repository ${url} already exists`)
		}

		this.logger.log(`Adding new repository: ${url}`)

		// Create repository instance and initialise it
		const repository = new AppRepository(this.#umbreld, url)
		await repository.update()

		// Save the repository URL
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const repositoryUrls = await get('appRepositories')
			repositoryUrls.push(url)
			await set('appRepositories', [...new Set(repositoryUrls)])
		})

		this.logger.log(`Added new repository: ${url}`)
		return true
	}

	async removeRepository(url: string) {
		// Check if repo exists
		const existingRepositories = await this.getRepositories()
		if (!existingRepositories.some((existingRepo) => existingRepo.url === url)) {
			throw new Error(`Repository ${url} does not exist`)
		}

		this.logger.log(`Removing repository: ${url}`)

		// Remove the repository URL
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const repositoryUrls = await get('appRepositories')
			const updatedRepositoryUrls = repositoryUrls.filter((repoUrl) => repoUrl !== url)
			await set('appRepositories', updatedRepositoryUrls)
		})

		this.logger.log(`Removed repository: ${url}`)
		return true
	}
}