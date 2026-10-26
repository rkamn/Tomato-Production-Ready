import { FoodItem, IItemVariant } from '../model/MenuItem.js';

export interface VariantSuggestion {
  name: string;
  price?: number | undefined;
  source?: 'catalog' | 'default' | undefined;
}

export function getDefaultVariantSuggestionsForCategory(category = '', name = ''): string[] {
  const text = `${category} ${name}`.toLowerCase();
  if (/\b(beverage|drink|coke|pepsi|water|juice|soda|cold drink|shake|smoothie|tea|coffee)\b/i.test(text)) {
    return ['250ml', '300ml', '500ml', '750ml', '1 Litre', '1.5 Litre', '2 Litre', 'Can', 'Glass', 'Bottle'];
  }
  if (/\b(pizza|burger|sandwich|momo|roll|platter|thali|biryani|meal|combo|fried rice|noodles)\b/i.test(text)) {
    return ['Regular', 'Medium', 'Large', 'Half', 'Full', 'Single', 'Double', 'Family Pack'];
  }
  if (/\b(grocery|groceries|rice|flour|oil|dal|sugar|pulse|spice|salt|wheat|atta|ghee|butter)\b/i.test(text)) {
    return ['100g', '250g', '500g', '1 kg', '2 kg', '5 kg', '10 kg', '1 Litre', '5 Litre', '1 pack'];
  }
  if (/\b(dairy|milk|paneer|curd|cheese|cream)\b/i.test(text)) {
    return ['200g', '500g', '1 kg', '250ml', '500ml', '1 Litre', '1 pack'];
  }
  if (/\b(snack|biscuit|chips|namkeen|chocolate|sweet|cookie)\b/i.test(text)) {
    return ['Small Pack', 'Medium Pack', 'Family Pack', '50g', '100g', '200g', '500g', '1 pack'];
  }
  return ['Regular', 'Medium', 'Large', 'Small (S)', 'Half', 'Full', '250ml', '500ml', '1 Litre', '500g', '1 kg'];
}

export async function getCatalogVariants(name?: string, category?: string): Promise<VariantSuggestion[]> {
  const suggestionsMap = new Map<string, VariantSuggestion>();

  // 1. If name is provided, search other shops/restaurants selling the same or similar item
  if (name && typeof name === 'string' && name.trim().length >= 2) {
    const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchedItems = await FoodItem.find({
      name: new RegExp(`^${escapedName}$`, 'i'),
      'variants.0': { $exists: true },
    }).select('variants name price').lean();

    for (const item of matchedItems) {
      if (Array.isArray(item.variants)) {
        for (const v of item.variants) {
          const vName = String(v.name || '').trim();
          if (vName && !suggestionsMap.has(vName.toLowerCase())) {
            suggestionsMap.set(vName.toLowerCase(), {
              name: vName,
              price: Number(v.price) || 0,
              source: 'catalog',
            });
          }
        }
      }
    }

    // Also partial name match if exact match returned few results
    if (suggestionsMap.size < 3) {
      const partialMatched = await FoodItem.find({
        name: new RegExp(escapedName, 'i'),
        'variants.0': { $exists: true },
      }).select('variants name price').limit(15).lean();

      for (const item of partialMatched) {
        if (Array.isArray(item.variants)) {
          for (const v of item.variants) {
            const vName = String(v.name || '').trim();
            if (vName && !suggestionsMap.has(vName.toLowerCase())) {
              suggestionsMap.set(vName.toLowerCase(), {
                name: vName,
                price: Number(v.price) || 0,
                source: 'catalog',
              });
            }
          }
        }
      }
    }
  }

  // 2. Also check if category has items with variants
  if (category && typeof category === 'string' && category.trim()) {
    const escapedCat = category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const catMatched = await FoodItem.find({
      category: new RegExp(`^${escapedCat}$`, 'i'),
      'variants.0': { $exists: true },
    }).select('variants price').limit(10).lean();

    for (const item of catMatched) {
      if (Array.isArray(item.variants)) {
        for (const v of item.variants) {
          const vName = String(v.name || '').trim();
          if (vName && !suggestionsMap.has(vName.toLowerCase())) {
            suggestionsMap.set(vName.toLowerCase(), {
              name: vName,
              price: Number(v.price) || 0,
              source: 'catalog',
            });
          }
        }
      }
    }
  }

  // 3. Add default suggestions for this category / name
  const defaults = getDefaultVariantSuggestionsForCategory(category, name);
  for (const def of defaults) {
    if (!suggestionsMap.has(def.toLowerCase())) {
      suggestionsMap.set(def.toLowerCase(), {
        name: def,
        price: undefined,
        source: 'default',
      });
    }
  }

  return Array.from(suggestionsMap.values());
}

export function sanitizeItemVariants(rawVariants: unknown): IItemVariant[] {
  if (!Array.isArray(rawVariants)) return [];
  const sanitized: IItemVariant[] = [];
  let foundDefault = false;

  for (const raw of rawVariants) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (!name) continue;
    const price = Math.max(0, Number(v.price ?? 0));
    const quantity = Math.max(0, Number(v.quantity ?? 10));
    const isDefault = Boolean(v.isDefault);
    const isAvailable = v.isAvailable !== undefined ? Boolean(v.isAvailable) : (quantity > 0);

    const variantObj: IItemVariant = {
      name,
      price,
      quantity,
      isDefault: false,
      isAvailable,
    };

    if (isDefault && !foundDefault) {
      variantObj.isDefault = true;
      foundDefault = true;
    }

    sanitized.push(variantObj);
  }

  if (sanitized.length > 0 && !foundDefault && sanitized[0]) {
    sanitized[0].isDefault = true;
  }

  return sanitized;
}
