"""Tests for the cookbook reader. Run with: python3 -m unittest discover -s test -p 'test_*.py'"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / 'scripts'))
import build_books as B  # noqa: E402

WRAP = '*** START OF THE BOOK ***\n\n{}\n\n*** END OF THE BOOK ***'


class ReadBook(unittest.TestCase):
    def read(self, text):
        return B.read_book(WRAP.format(text))

    def test_one_ingredient_per_line(self):
        # The Skilful Cook
        [r] = self.read("Dr. Kitchener's Broth.\n\n_Ingredients_--4\xa0oz. of Scotch barley.\n"
                        "               4\xa0oz. of sliced onions.\n               2\xa0oz. of dripping.\n"
                        "               3\xa0oz. bacon.\n\n_Method._--Wash the barley, and soak it in water for two "
                        "hours. Add the onions, fry the bacon in the dripping, and pour in the broth. Season with "
                        "pepper and salt.")
        self.assertEqual(r['i'][:4], [['Scotch barley', '4 oz.'], ['Sliced onions', '4 oz.'],
                                      ['Dripping', '2 oz.'], ['Bacon', '3 oz.']])
        self.assertNotIn('Broth', [name for name, _ in r['i']])   # the dish itself, not an ingredient
        self.assertIn('Salt', [name for name, _ in r['i']])

    def test_comma_list_across_lines(self):
        # Mrs Beeton
        [r] = self.read("BREAST OF LAMB AND GREEN PEAS.\n\n744. INGREDIENTS.--1 breast of lamb, a few slices of "
                        "bacon, 1/4 pint of\nstock No. 105, 1 lemon, 1 onion, 1 bunch of savoury herbs, green peas."
                        "\n\n_Mode_.--Remove the skin, put it into a saucepan of boiling water, and simmer it.")
        self.assertEqual(r['i'][:3], [['Breast of lamb', '1'], ['A few slices of bacon', ''], ['Stock', '1/4 pint']])

    def test_bullets_then_method(self):
        # Muskett
        [r] = self.read("PUMPKIN SOUP\n\n* 1 small Pumpkin--4d.\n*\n* 2 oz. Butter--2d.\n*\n* Time--One Hour.\n*\n"
                        "Peel and slice up the pumpkin, put it into a saucepan with the butter, and boil it.")
        self.assertEqual(r['i'][:2], [['Pumpkin', '1 small'], ['Butter', '2 oz.']])
        self.assertEqual(r['t'], 'One Hour')


class Squash(unittest.TestCase):
    def test_plain_squash_in_old_books_is_pumpkin(self):
        self.assertEqual(B.match_name('Squash, steamed and strained', '1 cup'), 'pumpkin')
        self.assertEqual(B.match_name('Winter squash'), 'pumpkin')
        self.assertEqual(B.match_name('Summer squash'), 'summer squash')
        self.assertEqual(B.match_name('Spaghetti squash'), 'spaghetti squash')

    def test_plain_squash_in_a_summer_squash_dish_stays_squash(self):
        self.assertEqual(B.match_name('Squash', '2', 'Summer Squash Bujea'), 'squash')
        self.assertEqual(B.match_name('Squash, sliced', '', 'Fried Scalloped Squash'), 'squash')
        self.assertEqual(B.match_name('Squash', '', 'Squash Pie'), 'pumpkin')


class Peppers(unittest.TestCase):
    def test_red_pepper_is_capsicum_only_when_its_the_vegetable(self):
        self.assertEqual(B.match_name('Red peppers, sliced', '2'), 'capsicum')
        self.assertEqual(B.match_name('Green peppers', ''), 'capsicum')
        self.assertEqual(B.match_name('Red pepper', '1/4 teaspoon'), 'red pepper')
        self.assertEqual(B.match_name('Red pepper', ''), 'red pepper')
        self.assertEqual(B.match_name('Crushed red pepper', '1 tsp'), 'crushed red pepper')


if __name__ == '__main__':
    unittest.main()
