// src/plugins/registry.ts
// Plugin registration and lookup

import { BusinessPlugin, PluginId } from './types';

/**
 * Plugin Registry - manages all registered business plugins
 */
class PluginRegistry {
  private plugins: Map<string, BusinessPlugin> = new Map();
  private defaultPluginId: string = PluginId.CAKE_CAFE;

  /**
   * Register a plugin
   */
  register(plugin: BusinessPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin ${plugin.id} is already registered. Overwriting.`);
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`Plugin registered: ${plugin.id} (${plugin.name} v${plugin.version})`);
  }

  /**
   * Get a plugin by ID
   */
  get(pluginId: string): BusinessPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get plugin or throw if not found
   */
  getOrThrow(pluginId: string): BusinessPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}. Available plugins: ${this.listPluginIds().join(', ')}`);
    }
    return plugin;
  }

  /**
   * Get the default plugin (cake-cafe)
   */
  getDefault(): BusinessPlugin {
    return this.getOrThrow(this.defaultPluginId);
  }

  /**
   * Set the default plugin ID
   */
  setDefault(pluginId: string): void {
    if (!this.plugins.has(pluginId)) {
      throw new Error(`Cannot set default: Plugin ${pluginId} not registered`);
    }
    this.defaultPluginId = pluginId;
  }

  /**
   * Check if a plugin is registered
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * List all registered plugin IDs
   */
  listPluginIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * List all registered plugins with info
   */
  listPlugins(): Array<{ id: string; name: string; version: string }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
    }));
  }

  /**
   * Unregister a plugin
   */
  unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /**
   * Clear all plugins (mainly for testing)
   */
  clear(): void {
    this.plugins.clear();
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();

/**
 * Get plugin for a business based on its plugin_id
 * Falls back to default plugin if not specified
 */
export function getPluginForBusiness(business: { plugin_id?: string }): BusinessPlugin {
  const pluginId = business.plugin_id || PluginId.CAKE_CAFE;
  return pluginRegistry.getOrThrow(pluginId);
}
