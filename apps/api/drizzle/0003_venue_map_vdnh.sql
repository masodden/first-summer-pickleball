-- Короткая ссылка на площадку ВДНХ; посев раньше оставлял старый map_url.
UPDATE "venues"
SET "address" = 'Москва, ВДНХ',
    "map_url" = 'https://yandex.ru/maps/-/CTGNBM4U'
WHERE "name" = 'First Summer Club, ВДНХ';
