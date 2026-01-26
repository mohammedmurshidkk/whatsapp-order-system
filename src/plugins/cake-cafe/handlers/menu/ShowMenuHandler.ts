/**
 * Show Menu Handler
 *
 * Handles displaying menu to customer:
 * - PDF menu documents (if configured)
 * - Interactive category lists (for large menus)
 * - Text format (fallback for small menus)
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { formatMenuForCustomer, buildCategoryListSections } from '../../services/menuService';
import {
  getActiveMenuPdfConfigs,
  getMenuPdfConfigBySlug,
} from '../../services/menuPdfConfigService';
import { getMenuPdfUrl, menuPdfExists } from '../../services/pdfService';
import { sendInteractiveListMessage } from '../../../../services/whatsapp';

/**
 * Show Menu - Display menu to customer
 */
export const showMenuHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!ctx.business?.id) {
    return { reply: t('menu.fallback', ctx.lang) };
  }

  const menuSlug = (aiResponse as any).menu_slug;

  // Check for specific menu request
  if (menuSlug) {
    const specificConfig = await getMenuPdfConfigBySlug(ctx.business.id, menuSlug);
    if (specificConfig?.pdf_url) {
      await ctx.sendDoc(ctx.phone, specificConfig.pdf_url, `${specificConfig.name}.pdf`, specificConfig.name);
      await ctx.saveOutgoingMessage(ctx.session.id, `[Sent ${specificConfig.name} PDF]`);
      return { reply: null, messageSaved: true };
    }
  }

  // Get all active menu PDF configs
  const menuConfigs = await getActiveMenuPdfConfigs(ctx.business.id);

  if (menuConfigs.length > 0) {
    // Send all menu PDFs
    for (const config of menuConfigs) {
      if (config.pdf_url) {
        await ctx.sendDoc(
          ctx.phone,
          config.pdf_url,
          `${config.name}.pdf`,
          config.name
        );
      }
    }
    await ctx.saveOutgoingMessage(ctx.session.id, `[Sent ${menuConfigs.length} menu PDF(s)]`);
    return { reply: null, messageSaved: true };
  }

  // Fallback to full menu PDF if no configs
  const pdfExists = await menuPdfExists(ctx.business.id);
  if (pdfExists) {
    const pdfUrl = getMenuPdfUrl(ctx.business.id);
    const menuCaption = t('menu.pdfCaption', ctx.lang);
    await ctx.sendDoc(ctx.phone, pdfUrl, `${ctx.business.name || 'Menu'}.pdf`, menuCaption);
    await ctx.saveOutgoingMessage(ctx.session.id, `[Menu PDF sent] ${menuCaption}`);
    return { reply: null, messageSaved: true };
  }

  // Fallback: Send interactive category list for large menus, text for small menus
  if (ctx.menuItems && ctx.menuCategories && ctx.menuItems.length > 0) {
    if (ctx.menuItems.length > 30 && ctx.menuCategories.length > 5) {
      // Large menu: Use interactive list with smart groupings
      const categorySections = buildCategoryListSections(ctx.menuCategories);
      if (categorySections.length > 0) {
        const menuIntro = t('menu.welcome', ctx.lang, { businessName: ctx.business?.name || t('menu.ourMenu', ctx.lang) });
        await ctx.saveOutgoingMessage(ctx.session.id, menuIntro);
        await ctx.sendList(
          ctx.phone,
          t('menu.ourMenu', ctx.lang),
          menuIntro,
          t('menu.browseBtn', ctx.lang),
          categorySections
        );
        return { reply: null, messageSaved: true };
      }
    }

    // Small menu or fallback: use text format
    return { reply: formatMenuForCustomer(ctx.menuItems, ctx.menuCategories) };
  }

  return { reply: t('menu.fallback', ctx.lang) };
};
